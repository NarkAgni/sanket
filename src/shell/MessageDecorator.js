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


import Gio from 'gi://Gio';
import St from 'gi://St';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {InjectionManager, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {moveOnto} from '../lib/Toggles.js';
import {hasClass, isActorAlive} from '../lib/Utils.js';
import {ReorderDrag, slideReorder} from '../ui/ReorderDrag.js';
import {CoverLayout, ImageMask, coverRatio} from '../ui/ImageMask.js';
import {centerPivot, fadeTo, jiggle, rotateTo, stopFade, stopJiggle, stopRotation} from '../ui/Animations.js';


const IMAGE_CLASS = 'sanket-message-image';
const FRAME_CLASS = 'sanket-message-image-frame';
const IMAGE_SIZE = 40;
const PINNED_CLASS = 'sanket-pinned';
const LOCKED_CLASS = 'sanket-pinned-close';
const DELETE_KEYS = [Clutter.KEY_Delete, Clutter.KEY_KP_Delete, Clutter.KEY_BackSpace];
const ACTIVATE_KEYS = [Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_ISO_Enter, Clutter.KEY_space];


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

function findImages(actor, found = []) {
    for (const child of actor.get_children()) {
        if (hasClass(child, 'message-icon'))
            found.push(child);
        else
            findImages(child, found);
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

function groupOf(child) {
    const item = child.get_parent();
    return item ? item.get_parent() : null;
}

function isExpandedGroup(message) {
    return Boolean(message) && Boolean(message._notificationToMessage) &&
        message._notificationToMessage.size > 1 && message.expanded;
}

function notificationsOf(message) {
    const notifications = message._notificationToMessage
        ? [...message._notificationToMessage.keys()]
        : [message.notification];
    return notifications.filter(isActorAlive);
}

function setResident(notification, resident) {
    const {datetime} = notification;
    notification.resident = resident;
    notification.datetime = datetime;
}

function filePathOf(gicon) {
    if (!gicon || !('get_file' in gicon))
        return null;
    return gicon.get_file().get_path();
}

function createOrderAdapter(messageList) {
    const view = messageList._messageView;
    if (view) {
        return {
            owner: view,
            container: view,
            methods: ['_addMessageAtIndex', '_moveMessage'],
            messages: () => view.messages,
            media: () => [...view._playerToMessage.values()],
            reorder: ordered => {
                view.messages.splice(0, view.messages.length, ...ordered);
                view.queue_relayout();
            },
        };
    }

    const section = messageList._notificationSection;
    return {
        owner: section,
        container: section._list,
        methods: ['addMessageAtIndex', 'moveMessage'],
        messages: () => section._list.get_children().map(item => item.child),
        media: () => [],
        reorder: ordered => ordered.forEach((message, index) =>
            section._list.set_child_at_index(message.get_parent(), index)),
    };
}

export class MessageDecorator {
    constructor(messageList, store, onChanged, onRefused) {
        this._store = store;
        this._onChanged = onChanged;
        this._onRefused = onRefused;
        this._autoPin = new WeakSet();
        this._injections = new InjectionManager();
        this._pinned = new WeakSet();
        this._shielded = new Set();
        this._clearedOthers = false;
        this._decorated = new WeakSet();
        this._held = new Map();
        this._entries = new Map();
        this._images = new Map();
        this._ratios = new Map();
        this._cancellable = new Gio.Cancellable();
        this._measuring = false;
        this._clearing = new WeakSet();
        this._groups = new WeakSet();
        this._order = createOrderAdapter(messageList);
        this._pinTimes = new WeakMap();
        this._restoredRanks = new WeakMap();
        this._slots = new Map();
        this._lastOrder = [];
        this._dragOrder = null;
        this._dragUnit = null;
        const bounds = () => messageList._scrollView;
        this._pinDrag = new ReorderDrag(
            () => this._pinnedOrder().filter(unit => unit.mapped),
            (dragged, target) => this._dragTo(dragged, target),
            () => this._dropPinned(),
            {modifier: Clutter.ModifierType.CONTROL_MASK, canStart: unit => !isExpandedGroup(unit), vertical: true, bounds});
        this._stackDrag = new ReorderDrag(
            () => this._expandedPinnedMessages(),
            (dragged, target) => this._moveInStack(dragged, target),
            () => {},
            {modifier: Clutter.ModifierType.CONTROL_MASK, canStart: child => isExpandedGroup(groupOf(child)), vertical: true, bounds});
        this._pinDrag.setEnabled(true);
        this._stackDrag.setEnabled(true);

        const decorator = this;
        this._order.methods.forEach(method =>
            this._injections.overrideMethod(this._order.owner, method, original =>
                function (message, index, ...rest) {
                    return original.call(this, message, decorator._indexFor(message, index), ...rest);
                }));
        if (messageList._messageView) {
            this._injections.overrideMethod(messageList._messageView, 'clear', original => function (...args) {
                decorator._noteClear();
                const pinned = this.messages.filter(message => decorator.isPinned(message));
                pinned.forEach(message => decorator._shielded.add(message));
                this.messages.filter(message => message.canClose()).forEach(message => decorator._clearing.add(message));
                try {
                    original.call(this, ...args);
                } finally {
                    pinned.forEach(message => decorator._shielded.delete(message));
                }
                pinned.forEach(message => decorator._closeUnpinned(message));
            });
        } else {
            this._injections.overrideMethod(this._order.owner, 'clear', original => function (...args) {
                decorator._noteClear();
                return original.call(this, ...args);
            });
        }
    }

    isPinned(message) {
        return notificationsOf(message).some(notification => this._pinned.has(notification));
    }

    get clearedOthers() {
        return this._clearedOthers;
    }

    _noteClear() {
        this._clearedOthers = this._order.messages()
            .some(message => message.canClose() && notificationsOf(message).some(notification => !this._pinned.has(notification)));
    }

    pinnedRank(message) {
        return this._pinnedOrder().indexOf(message);
    }

        pinnedCards(message) {
        return [...this._entries.values()]
            .filter(entry => entry.message === message && this._isEntryPinned(entry) && entry.owner.mapped)
            .map(entry => entry.owner);
    }

    measure(callback) {
        this._measuring = true;
        try {
            return callback();
        } finally {
            this._measuring = false;
        }
    }

    decorate(message) {
        if (message._notificationToMessage)
            this._watchGroup(message);
        findCloseButtons(message)
            .filter(closeButton => !this._decorated.has(closeButton))
            .forEach(closeButton => this._addEntry(message, closeButton));
        findImages(message)
            .filter(image => !this._images.has(image))
            .forEach(image => this._placeImage(image));
        [...this._entries.values()]
            .filter(entry => entry.message === message && !this._isEntryPinned(entry) &&
                this._autoPin.has(entry.owner.notification))
            .forEach(entry => this._setPinned(entry, true));
        notificationsOf(message)
            .filter(notification => this._pinned.has(notification))
            .forEach(notification => this._hold(notification));

        this._pinDrag.watch(message);
        if (message._notificationToMessage)
            this._stackedMessages(message).forEach(child => this._stackDrag.watch(child));
        this._arrange(null);
    }

    pinRestored(restored) {
        restored.forEach(({notification, pinnedAt, rank}) => {
            this._autoPin.add(notification);
            this._pinTimes.set(notification, pinnedAt);
            this._restoredRanks.set(notification, rank);
        });
    }

    keepHeld() {
        [...this._held.keys()].forEach(notification => this._store.track(notification, this._pinTimeOf(notification)));
        this._saveRanks();
    }

    unexpandAll() {
        this._entries.forEach(({owner}) => {
            if (isActorAlive(owner) && owner.expanded)
                owner.unexpand(true);
        });
    }

    destroy() {
        this._cancellable.cancel();
        this._pinDrag.destroy();
        this._stackDrag.destroy();
        this._injections.clear();
        this._order.messages().forEach(message => message.disconnectObject(this));
        [...this._held.keys()].forEach(notification => this._release(notification, false));
        [...this._entries.values()].forEach(entry => this._cleanupEntry(entry, true));
        this._entries.clear();
        this._images.forEach((placed, image) => this._restoreImage(image, placed));
        this._images.clear();

        this._cancellable = null;
        this._injections = null;
        this._held = null;
        this._images = null;
        this._ratios = null;
        this._entries = null;
        this._pinned = null;
        this._shielded = null;
        this._decorated = null;
        this._order = null;
        this._store = null;
        this._autoPin = null;
        this._pinTimes = null;
        this._restoredRanks = null;
        this._slots = null;
        this._lastOrder = null;
        this._pinDrag = null;
        this._stackDrag = null;
        this._onRefused = null;
        this._clearing = null;
        this._groups = null;
        this._onChanged = null;
    }

    _watchGroup(group) {
        if (this._groups.has(group))
            return;

        const decorator = this;
        this._groups.add(group);
        this._injections.overrideMethod(group, 'close', original => function () {
            const item = this.get_first_child();
            const top = item ? item.child : null;
            if (decorator._clearing.has(this) || this.expanded || !top || !top.notification) {
                decorator._clearing.delete(this);
                if (decorator.isPinned(this))
                    decorator._closeUnpinned(this);
                else
                    original.call(this);
                return;
            }
            if (decorator._pinned.has(top.notification))
                return;

            top._closed = true;
            top.notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
        });
        this._injections.overrideMethod(group, 'canClose', original => function () {
            return !decorator._shielded.has(this) && original.call(this);
        });
        this._injections.overrideMethod(group, '_addNotification', original => function (notification) {
            original.call(this, notification);
            decorator._placeBelowPinned(this, notification);
        });
        group.connectObject('destroy', () =>
            ['close', 'canClose', '_addNotification'].forEach(method => this._injections.restoreMethod(group, method)),
        this);
    }

    _stackedMessages(group) {
        return group.get_children()
            .filter(item => item !== group._cover && item !== group._headerBox)
            .map(item => item.child);
    }

    _pinnedOnTop(group, except = null) {
        return this._stackedMessages(group)
            .filter(message => message !== except && this._pinned.has(message.notification)).length;
    }

    _placeBelowPinned(group, notification) {
        const count = this._pinnedOnTop(group);
        const message = group._notificationToMessage.get(notification);
        if (count === 0 || !message)
            return;

        group.set_child_at_index(message.get_parent(), count + 1);
        group._ensureCoverPosition();
        group._updateStackedMessagesFade();
    }

    _raiseInGroup(group, message) {
        if (this._stackedMessages(group).indexOf(message) !== 0)
            group._moveMessage(message, 0);
    }

    _expandedPinnedMessages() {
        const group = this._order.messages().find(isExpandedGroup);
        if (!group)
            return [];

        return this._stackedMessages(group).filter(message => this._pinned.has(message.notification) && message.mapped);
    }

    _moveInStack(dragged, target) {
        const group = groupOf(dragged);
        const items = this._stackedMessages(group).map(message => message.get_parent());
        slideReorder(group, () => {
            moveOnto(items, dragged.get_parent(), target.get_parent()).forEach((item, index) =>
                group.set_child_at_index(item, index > 0 ? index + 1 : index));
            group._ensureCoverPosition();
            group._updateStackedMessagesFade();
        }, dragged.get_parent());
    }

    _pinTimeOf(notification) {
        return this._pinTimes.has(notification) ? this._pinTimes.get(notification) : 0;
    }

    _unitTime(unit) {
        return Math.max(0, ...notificationsOf(unit)
            .filter(notification => this._pinned.has(notification))
            .map(notification => this._pinTimeOf(notification)));
    }

    _pinnedOrder() {
        if (this._dragOrder)
            return this._dragOrder.filter(unit => this.isPinned(unit));

        const units = this._order.messages().filter(message => this.isPinned(message));
        this._compactSlots(units);

        const order = new Array(units.length).fill(null);
        [...this._slots.keys()]
            .sort((first, second) => this._slots.get(first) - this._slots.get(second))
            .forEach(unit => {
                const wanted = Math.min(this._slots.get(unit), units.length - 1);
                const free = order.findIndex((other, index) => !other && index >= wanted);
                order[free >= 0 ? free : order.lastIndexOf(null)] = unit;
            });

        const automatic = units
            .filter(unit => !this._slots.has(unit))
            .sort((first, second) => this._unitTime(second) - this._unitTime(first));
        let next = 0;
        this._lastOrder = order.map(unit => unit || automatic[next++]);
        return this._lastOrder;
    }

    _compactSlots(units) {
        this._lastOrder
            .map((unit, index) => units.includes(unit) ? -1 : index)
            .filter(index => index >= 0)
            .reverse()
            .forEach(removed => this._slots.forEach((slot, unit) => {
                if (slot > removed)
                    this._slots.set(unit, slot - 1);
            }));
        [...this._slots.keys()]
            .filter(unit => !units.includes(unit))
            .forEach(unit => this._slots.delete(unit));
    }

    _arrange(skip) {
        const media = this._order.media();
        const pinned = this._pinnedOrder();
        const current = this._order.messages();
        const rest = current.filter(message => !media.includes(message) && !pinned.includes(message));
        const ordered = [...media, ...pinned, ...rest];
        if (ordered.every((message, index) => current[index] === message))
            return;

        slideReorder(this._order.container, () => this._order.reorder(ordered), skip);
    }

    _dragTo(unit, target) {
        this._dragOrder = moveOnto(this._pinnedOrder(), unit, target);
        this._dragUnit = unit;
        this._arrange(unit.get_parent());
    }

    _dropPinned() {
        const order = this._dragOrder;
        const unit = this._dragUnit;
        this._dragOrder = null;
        this._dragUnit = null;
        if (!order || !isActorAlive(unit))
            return;

        const pinned = order.filter(other => this.isPinned(other));
        pinned.forEach((other, index) => {
            if (other === unit || this._slots.has(other))
                this._slots.set(other, index);
        });
        this._lastOrder = pinned;
        this._arrange(null);
        this._saveRanks();
        this._onChanged();
    }

    _adoptRank(unit, notification) {
        const rank = this._restoredRanks.has(notification) ? this._restoredRanks.get(notification) : -1;
        this._restoredRanks.delete(notification);
        if (rank >= 0 && !this._slots.has(unit))
            this._slots.set(unit, rank);
    }

    _saveRanks() {
        const ranks = new Map();
        this._slots.forEach((slot, unit) => notificationsOf(unit)
            .filter(notification => this._pinned.has(notification))
            .forEach(notification => ranks.set(notification, slot)));
        this._store.setRanks(ranks);
    }

    _closeUnpinned(message) {
        notificationsOf(message)
            .filter(notification => !this._pinned.has(notification))
            .forEach(notification => notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED));
    }

    _isEntryPinned(entry) {
        return Boolean(entry.owner.notification) && this._pinned.has(entry.owner.notification);
    }

    _hold(notification) {
        if (!this._held.has(notification)) {
            this._held.set(notification, notification.resident);
            notification.connectObject(
                'notify::resident', () => {
                    if (notification.resident)
                        return;
                    this._held.set(notification, false);
                    setResident(notification, true);
                },
                'notify::title', () => this._store.refresh(notification),
                'notify::body', () => this._store.refresh(notification),
                'destroy', (_notification, reason) => this._onHeldDestroyed(notification, reason),
                this);
            this._store.track(notification, this._pinTimeOf(notification));
        }
        if (!notification.resident)
            setResident(notification, true);
    }

    _release(notification, forget) {
        if (!this._held.has(notification))
            return;

        const resident = this._held.get(notification);
        this._held.delete(notification);
        notification.disconnectObject(this);
        setResident(notification, resident);
        if (forget)
            this._store.untrack(notification);
    }

    _onHeldDestroyed(notification, reason) {
        this._held.delete(notification);
        if (reason !== MessageTray.NotificationDestroyedReason.SOURCE_CLOSED) {
            this._store.untrack(notification);
            return;
        }

        const copy = this._store.keep(notification);
        if (copy)
            this.pinRestored([copy]);
    }

    _onCaptured(entry, event) {
        if (!this._isEntryPinned(entry))
            return Clutter.EVENT_PROPAGATE;

        const type = event.type();
        const target = global.stage.get_event_actor(event);
        const onClose = Boolean(target) && entry.closeButton.contains(target);

        if (onClose && (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN))
            return Clutter.EVENT_STOP;
        if (onClose && (type === Clutter.EventType.BUTTON_RELEASE || type === Clutter.EventType.TOUCH_END)) {
            this._refuse(entry);
            return Clutter.EVENT_STOP;
        }
        if (type !== Clutter.EventType.KEY_PRESS)
            return Clutter.EVENT_PROPAGATE;

        const symbol = event.get_key_symbol();
        const closing = DELETE_KEYS.includes(symbol) || (onClose && ACTIVATE_KEYS.includes(symbol));
        if (!closing)
            return Clutter.EVENT_PROPAGATE;

        this._refuse(entry);
        return Clutter.EVENT_STOP;
    }

    _refuse(entry) {
        jiggle(entry.owner);
        this._onRefused(entry.owner);
    }

    _cleanupEntry(entry, restore) {
        if (!this._entries || !this._entries.has(entry.pin))
            return;

        this._entries.delete(entry.pin);
        this._injections.restoreMethod(entry.owner, 'close');
        this._injections.restoreMethod(entry.owner, 'canClose');

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
            if (isActorAlive(entry.closeButton))
                entry.closeButton.remove_style_class_name(LOCKED_CLASS);
            stopJiggle(entry.owner);
            stopFade(entry.closeButton);
            stopFade(entry.expandButton);
            stopRotation(entry.expandButton, entry.expanded ? 180 : 0);
            if (isActorAlive(entry.pin))
                entry.pin.destroy();
        }
    }

    _ratioOf(gicon, onLoaded) {
        if (gicon && 'get_width' in gicon)
            return coverRatio(gicon.get_width(), gicon.get_height());

        const path = filePathOf(gicon);
        if (!path)
            return 1;
        if (this._ratios.has(path))
            return this._ratios.get(path);

        const cancellable = this._cancellable;
        GdkPixbuf.Pixbuf.get_file_info_async(path, cancellable, (_source, result) => {
            if (cancellable.is_cancelled())
                return;

            let ratio = 1;
            try {
                const [, width, height] = GdkPixbuf.Pixbuf.get_file_info_finish(result);
                ratio = coverRatio(width, height);
            } catch (error) {
                logError(error, `Sanket: could not read ${path}`);
            }
            this._ratios.set(path, ratio);
            onLoaded();
        });
        return 1;
    }

    _placeImage(image) {
        const frame = new St.Widget({
            style_class: FRAME_CLASS,
            style: `width: ${IMAGE_SIZE}px; height: ${IMAGE_SIZE}px;`,
            clip_to_allocation: true,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new CoverLayout(),
        });
        const mask = new ImageMask();
        const parent = image.get_parent();

        parent.insert_child_above(frame, image.get_next_sibling());
        parent.remove_child(image);
        frame.add_child(image);
        frame.add_effect(mask);
        image.add_style_class_name(IMAGE_CLASS);

        const binding = image.bind_property('visible', frame, 'visible', GObject.BindingFlags.SYNC_CREATE);
        const sync = () => {
            if (!this._images.has(image))
                return;

            mask.enabled = !image.is_symbolic;
            image.icon_size = image.is_symbolic ? -1 : Math.round(IMAGE_SIZE * this._ratioOf(image.gicon, sync));
        };

        this._images.set(image, {frame, binding});
        image.connectObject(
            'notify::gicon', sync,
            'notify::is-symbolic', sync,
            'destroy', () => this._images.delete(image),
            this);
        sync();
    }

    _restoreImage(image, {frame, binding}) {
        image.disconnectObject(this);
        binding.unbind();
        image.icon_size = -1;
        image.remove_style_class_name(IMAGE_CLASS);

        const parent = frame.get_parent();
        frame.remove_child(image);
        parent.insert_child_below(image, null);
        frame.destroy();
    }

    _addEntry(message, closeButton) {
        const owner = findOwner(closeButton);
        const header = closeButton.get_parent();
        const pin = new St.Button({
            style_class: 'message-close-button sanket-pin-button',
            icon_name: 'view-pin-symbolic',
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
        this._injections.overrideMethod(owner, 'close', original => function () {
            if (this.notification) {
                this._closed = true;
                this.notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
            } else {
                original.call(this);
            }
        });
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
            body.layout_manager.connectObject('notify::expansion', () => {
                if (!this._measuring)
                    applyExpansion(body);
            }, this);
            let width = -1;
            body.connectObject('notify::allocation', () => {
                const current = body.allocation.get_width();
                if (current !== width) {
                    width = current;
                    sync();
                }
            }, this);
            const text = textOf(body);
            if (text)
                text.connectObject('notify::text', sync, this);
        });

        pin.connectObject(
            'clicked', () => this._setPinned(entry, !this._isEntryPinned(entry)),
            'destroy', () => this._cleanupEntry(entry, false),
            this);
        closeButton.connectObject(
            'destroy', () => this._cleanupEntry(entry, false),
            this);
        owner.connectObject(
            'captured-event', (_owner, event) => this._onCaptured(entry, event),
            'notify::hover', sync,
            'expanded', () => this._onExpansion(entry, true),
            'unexpanded', () => this._onExpansion(entry, false),
            'destroy', () => this._cleanupEntry(entry, false),
            this);

        this._decorated.add(closeButton);
        this._entries.set(pin, entry);
        header.insert_child_below(pin, closeButton);

        this._syncPin(entry);
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

            const width = body.allocation.get_width();
            const [, naturalWidth] = text.get_preferred_width(-1);
            return (width > 0 && naturalWidth > width) || text.text.includes('\n');
        });
    }

    _syncPin(entry) {
        const pinned = this._isEntryPinned(entry);
        if (pinned) {
            entry.pin.add_style_class_name(PINNED_CLASS);
            entry.closeButton.add_style_class_name(LOCKED_CLASS);
        } else {
            entry.pin.remove_style_class_name(PINNED_CLASS);
            entry.closeButton.remove_style_class_name(LOCKED_CLASS);
        }
        entry.pin.accessible_name = pinned ? _('Unpin') : _('Pin');
    }

    _syncButtons(entry, animate) {
        if (!isActorAlive(entry.owner) || !isActorAlive(entry.pin) || !isActorAlive(entry.closeButton))
            return;

        const hovered = entry.owner.hover;
        const pinned = this._isEntryPinned(entry);
        fadeTo(entry.pin, hovered || pinned, animate);
        fadeTo(entry.closeButton, pinned || (hovered && entry.closeButton.reactive), animate);

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

    _setPinned(entry, pinned) {
        const {message, owner} = entry;
        const {notification} = owner;
        if (!isActorAlive(notification))
            return;

        if (pinned) {
            if (!this._pinTimes.has(notification))
                this._pinTimes.set(notification, Date.now());
            this._pinned.add(notification);
            this._injections.overrideMethod(owner, 'canClose', () => () => false);
            this._hold(notification);
            this._adoptRank(message, notification);
            if (message !== owner)
                this._raiseInGroup(message, owner);
        } else {
            this._pinTimes.delete(notification);
            this._pinned.delete(notification);
            this._injections.restoreMethod(owner, 'canClose');
            this._release(notification, true);
        }

        this._syncPin(entry);
        this._syncButtons(entry, true);
        this._arrange(null);
        this._saveRanks();
        this._onChanged();
    }

    _indexFor(message, index) {
        const media = this._order.media();
        if (index < 0 || media.includes(message))
            return index;

        const pinned = this._pinnedOrder();
        const rank = pinned.indexOf(message);
        return rank >= 0 ? media.length + rank : Math.max(index, media.length + pinned.length);
    }
}