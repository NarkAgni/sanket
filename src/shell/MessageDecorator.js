/*
* Sanket GNOME Extension
* Copyright (C) 2026 NarkAgni
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program. If not, see <https://www.gnu.org/licenses/>.
*/


import St from 'gi://St';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import {isActorAlive} from '../lib/Utils.js';
import {centerPivot, fadeTo, rotateTo, stopFade, stopRotation} from '../ui/Animations.js';


function hasClass(actor, styleClass) {
    return Boolean(actor.has_style_class_name) && actor.has_style_class_name(styleClass);
}

function findCloseButtons(actor, found = []) {
    for (const child of actor.get_children()) {
        if (hasClass(child, 'sanket-pin-button'))
            continue;
        if (hasClass(child, 'message-close-button'))
            found.push(child);
        else
            findCloseButtons(child, found);
    }
    return found;
}

function findBodies(actor, found = []) {
    for (const child of actor.get_children()) {
        if (child.layout_manager && 'expandLines' in child.layout_manager)
            found.push(child);
        else
            findBodies(child, found);
    }
    return found;
}

function findOwner(actor) {
    let owner = actor.get_parent();
    while (!hasClass(owner, 'message'))
        owner = owner.get_parent();
    return owner;
}

function textOf(body) {
    const label = body.get_first_child();
    return isActorAlive(label) && isActorAlive(label.clutter_text) ? label.clutter_text : null;
}

function applyExpansion(body) {
    const text = textOf(body);
    if (!text)
        return;

    const expanded = body.layout_manager.expansion > 0;
    text.line_wrap = true;
    text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    text.single_line_mode = !expanded;
    text.ellipsize = expanded ? Pango.EllipsizeMode.NONE : Pango.EllipsizeMode.END;
}

function createOrderAdapter(messageList) {
    const view = messageList._messageView;
    if (view) {
        return {
            owner: view,
            methods: ['_addMessageAtIndex', '_moveMessage'],
            messages: () => view.messages,
            media: () => [...view._playerToMessage.values()],
        };
    }

    const section = messageList._notificationSection;
    return {
        owner: section,
        methods: ['addMessageAtIndex', 'moveMessage'],
        messages: () => section._messages,
        media: () => [],
    };
}

export class MessageDecorator {
    constructor(messageList, onChanged) {
        this._onChanged = onChanged;
        this._injections = new InjectionManager();
        this._pinned = new WeakSet();
        this._decorated = new WeakSet();
        this._entries = new Map();
        this._order = createOrderAdapter(messageList);

        const decorator = this;
        this._order.methods.forEach(method =>
            this._injections.overrideMethod(this._order.owner, method, original =>
                function (message, index, ...rest) {
                    return original.call(this, message, decorator._indexFor(message, index), ...rest);
                }));

        this._injections.overrideMethod(MessageTray.Notification.prototype, 'activate', original =>
            function () {
                const resident = this.resident;
                this.resident = true;
                original.call(this);
                this.resident = resident;
            });
    }

    isPinned(message) {
        return this._pinned.has(message);
    }

    decorate(message) {
        findCloseButtons(message)
            .filter(closeButton => !this._decorated.has(closeButton))
            .forEach(closeButton => this._addEntry(message, closeButton));
    }

    unexpandAll() {
        this._entries.forEach(({owner}) => {
            if (isActorAlive(owner) && owner.expanded)
                owner.unexpand(true);
        });
    }

    destroy() {
        this._injections.clear();
        [...this._entries.values()].forEach(entry => this._cleanupEntry(entry, true));
        this._entries.clear();

        this._injections = null;
        this._entries = null;
        this._pinned = null;
        this._decorated = null;
        this._order = null;
        this._onChanged = null;
    }

    _cleanupEntry(entry, restore) {
        if (!this._entries || !this._entries.has(entry.pin))
            return;

        this._entries.delete(entry.pin);

        [entry.owner, entry.pin, entry.closeButton, entry.expandButton]
            .filter(isActorAlive)
            .forEach(actor => actor.disconnectObject(this));

        entry.bodies.forEach((body, index) => {
            if (!isActorAlive(body))
                return;
            body.disconnectObject(this);
            body.layout_manager.disconnectObject(this);
            body.clip_to_allocation = entry.clips[index];
            const text = textOf(body);
            if (text)
                text.disconnectObject(this);
        });

        if (restore) {
            stopFade(entry.closeButton);
            stopFade(entry.expandButton);
            stopRotation(entry.expandButton, entry.expanded ? 180 : 0);
            if (isActorAlive(entry.pin))
                entry.pin.destroy();
        }
    }

    _addEntry(message, closeButton) {
        const owner = findOwner(closeButton);
        const header = closeButton.get_parent();
        const pin = new St.Button({
            style_class: 'message-close-button sanket-pin-button',
            icon_name: 'view-pin-symbolic',
            toggle_mode: true,
            checked: this.isPinned(message),
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const expandButton = header.get_children().find(child => hasClass(child, 'message-expand-button')) || null;
        const entry = {
            message,
            owner,
            pin,
            closeButton,
            expandButton,
            expandShown: false,
            bodies: findBodies(owner),
            expanded: Boolean(owner.expanded),
        };
        entry.clips = entry.bodies.map(body => body.clip_to_allocation);
        const sync = () => this._syncButtons(entry, true);

        if (expandButton) {
            centerPivot(expandButton);
            expandButton.reactive = true;
            expandButton.can_focus = true;

            let wasExpanded = entry.expanded;
            expandButton.connectObject(
                'notify::reactive', sync,
                'notify::opacity', () => this._holdExpandOpacity(entry),
                'button-press-event', () => {
                    wasExpanded = Boolean(owner.expanded);
                    return Clutter.EVENT_PROPAGATE;
                },
                'clicked', () => {
                    if (!this._canExpand(entry) || Boolean(owner.expanded) !== wasExpanded)
                        return;
                    if (owner.expanded)
                        owner.unexpand(true);
                    else
                        owner.expand(true);
                },
                this);
        }

        entry.bodies.forEach(body => {
            body.clip_to_allocation = true;
            applyExpansion(body);
            body.layout_manager.connectObject('notify::expansion', () => applyExpansion(body), this);
            body.connectObject('notify::allocation', sync, this);
            const text = textOf(body);
            if (text)
                text.connectObject('notify::text', sync, this);
        });

        pin.connectObject(
            'clicked', () => this._toggle(message),
            'destroy', () => this._cleanupEntry(entry, false),
            this);
        closeButton.connectObject(
            'destroy', () => this._cleanupEntry(entry, false),
            this);
        owner.connectObject(
            'notify::hover', sync,
            'expanded', () => this._onExpansion(entry, true),
            'unexpanded', () => this._onExpansion(entry, false),
            'destroy', () => this._cleanupEntry(entry, false),
            this);

        this._decorated.add(closeButton);
        this._entries.set(pin, entry);
        header.insert_child_below(pin, closeButton);

        this._syncButtons(entry, false);
    }

    _onExpansion(entry, expanded) {
        entry.expanded = expanded;
        this._syncButtons(entry, true);
        this._onChanged();
    }

    _canExpand(entry) {
        const {owner, expandButton, bodies} = entry;
        if (!isActorAlive(owner) || !isActorAlive(expandButton))
            return false;
        if (entry.expanded)
            return true;
        if (isActorAlive(owner._actionBin) && owner._actionBin.visible && owner._actionBin.get_n_children() > 0)
            return true;

        return bodies.filter(isActorAlive).some(body => {
            const text = textOf(body);
            if (!text)
                return false;

            const layout = text.get_layout();
            if (layout && (layout.is_ellipsized() || layout.get_line_count() > 1))
                return true;

            const width = body.get_allocation_box().get_width();
            const [, naturalWidth] = text.get_preferred_width(-1);
            return (width > 0 && naturalWidth > width) || text.text.includes('\n');
        });
    }

    _syncButtons(entry, animate) {
        if (!isActorAlive(entry.owner) || !isActorAlive(entry.pin) || !isActorAlive(entry.closeButton))
            return;

        const hovered = entry.owner.hover;
        fadeTo(entry.pin, hovered, animate);
        fadeTo(entry.closeButton, hovered && entry.closeButton.reactive, animate);

        if (!isActorAlive(entry.expandButton))
            return;

        const canExpand = this._canExpand(entry);
        const angle = entry.expanded ? 180 : 0;
        entry.expandButton.visible = canExpand;
        entry.expandButton.reactive = canExpand;
        entry.expandShown = hovered && canExpand;
        fadeTo(entry.expandButton, entry.expandShown, animate);

        if (animate)
            rotateTo(entry.expandButton, angle);
        else
            stopRotation(entry.expandButton, angle);
    }

    _holdExpandOpacity(entry) {
        const button = entry.expandButton;
        const opacity = entry.expandShown ? 255 : 0;
        if (!button.get_transition('opacity') && button.opacity !== opacity)
            button.opacity = opacity;
    }

    _toggle(message) {
        const pinned = !this.isPinned(message);

        if (pinned) {
            this._pinned.add(message);
            this._injections.overrideMethod(message, 'canClose', () => () => false);
        } else {
            this._pinned.delete(message);
            this._injections.restoreMethod(message, 'canClose');
        }

        this._entries.forEach(entry => {
            if (entry.message !== message)
                return;
            entry.pin.checked = pinned;
            this._syncButtons(entry, true);
        });

        this._order.owner[this._order.methods[1]](message, this._pinnedFloor(message), true);
        this._onChanged();
    }

    _pinnedFloor(message) {
        const pinned = this._order.messages().filter(other => other !== message && this.isPinned(other));
        return this._order.media().length + pinned.length;
    }

    _indexFor(message, index) {
        if (index < 0 || this.isPinned(message) || this._order.media().includes(message))
            return index;
        return Math.max(index, this._pinnedFloor(message));
    }
}