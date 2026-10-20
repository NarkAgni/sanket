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
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {IslandLayout} from './IslandLayout.js';
import {TimeoutTracker} from '../lib/TimeoutTracker.js';
import {ScrollbarAutoHide} from './ScrollbarAutoHide.js';
import {MessageDecorator} from '../shell/MessageDecorator.js';
import {CHILD_ADDED, CHILD_REMOVED, createBox, detachActor, isActorAlive} from '../lib/Utils.js';
import {FAST_DURATION, MODE, centerPivot, easeTo, rotateTo, scaled, stopFade, stopRotation} from './Animations.js';


const PILL_ANGLE = 90;
const PILL_ROTATE_DURATION = 420;
const PILL_ROTATE_MODE = Clutter.AnimationMode.EASE_OUT_BACK;
const PILL_TEXT_OUT_DURATION = 110;
const PILL_TEXT_IN_DURATION = 300;
const PILL_TEXT_SHIFT = 6;
const REVEAL_DURATION = 340;
const REVEAL_MODE = Clutter.AnimationMode.EASE_OUT_QUART;
const CARD_SHIFT = 8;
const SETTLE_DELAY = 320;
const FOLLOWED_PROPERTIES = ['translation-x', 'translation-y'];
const CARD_CLASS = 'sanket-notif-card';
const PILL_CLASS = 'sanket-more-pill-btn';

function stackSize(message) {
    return message._notificationToMessage ? message._notificationToMessage.size : 1;
}

function setShown(wrapper, shown) {
    wrapper.visible = shown;
    wrapper.set_height(shown ? -1 : 0);
}

export class NotificationIsland {
    constructor(menu, dateMenu, compactToggles, settings) {
        this._menu = menu;
        this._settings = settings;
        this._dateMenu = dateMenu;
        this._compactToggles = compactToggles;
        this._boxPointer = menu._boxPointer;
        this._qsBox = menu.box;
        this._overlay = menu._overlay;

        this._messageList = dateMenu._messageList;
        this._messageView = this._messageList._messageView;
        this._lists = this._messageView
            ? [this._messageView]
            : [this._messageList._mediaSection._list, this._messageList._notificationSection._list];

        this._timers = new TimeoutTracker();
        this._trackedGroups = new WeakSet();
        this._groupShown = new WeakMap();
        this._reveals = new WeakMap();
        this._expanded = false;
        this._cardShown = false;
        this._pillText = '';
        this._syncId = 0;
        this._settleId = 0;

        this._decorator = new MessageDecorator(this._messageList, () => this._onMessagesChanged());

        this._buildActors();
        this._adoptMessageList();
        this._centerControls();
        this._followTheme();
        this._connectSignals();
        this._sync(false);
    }

    setExpanded(expanded) {
        this._applyExpanded(expanded);
        this._sync(true);
    }

    _clearBindings() {
        if (!this._bindings)
            return;
        this._bindings.forEach(binding => binding.unbind());
        this._bindings = null;
    }

    destroy() {
        this._timers.destroy();
        this._clearBindings();
        this._settings.disconnectObject(this);

        if (this._menu)
            this._menu.disconnectObject(this);
        if (isActorAlive(this._boxPointer))
            this._boxPointer.disconnectObject(this);
        if (isActorAlive(this._holder))
            this._holder.disconnectObject(this);

        this._lists.filter(isActorAlive).forEach(list => list.disconnectObject(this));
        Main.messageTray.disconnectObject(this);
        for (const source of Main.messageTray.getSources()) {
            source.disconnectObject(this);
            source.notifications.forEach(notification => notification.disconnectObject(this));
        }

        if (isActorAlive(this._messageList)) {
            this._scan().groups.forEach(({wrapper, message}) => {
                if (isActorAlive(message))
                    message.disconnectObject(this);
                if (isActorAlive(wrapper)) {
                    this._stopReveal(wrapper);
                    setShown(wrapper, true);
                }
            });
        }

        this._decorator.destroy();
        this._scrollbar.destroy();
        this._restoreTheme();
        this._restoreControls();
        this._releaseMessageList();
        if (isActorAlive(this._holder))
            this._holder.destroy();

        this._decorator = null;
        this._scrollbar = null;
        this._layout = null;
        this._holder = null;
        this._card = null;
        this._panel = null;
        this._pill = null;
        this._pillLabel = null;
        this._pillIcon = null;
        this._lists = null;
        this._trackedGroups = null;
        this._groupShown = null;
        this._reveals = null;
        this._messageView = null;
        this._messageList = null;
        this._overlay = null;
        this._qsBox = null;
        this._boxPointer = null;
        this._compactToggles = null;
        this._dateMenu = null;
        this._settings = null;
        this._menu = null;
    }

    _buildActors() {
        this._pillLabel = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            clip_to_allocation: true,
        });
        this._pillLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        this._pillIcon = new St.Icon({
            style_class: 'sanket-more-pill-icon',
            icon_name: 'go-next-symbolic',
            icon_size: 14,
            y_align: Clutter.ActorAlign.CENTER,
        });
        centerPivot(this._pillIcon);

        const pillContent = createBox(false, 'sanket-more-pill-content');
        pillContent.add_child(this._pillLabel);
        pillContent.add_child(this._pillIcon);

        this._pill = new St.Button({
            style_class: `button ${PILL_CLASS}`,
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            child: pillContent,
        });
        this._pill.connectObject('clicked', () => this.setExpanded(!this._expanded), this);

        this._panel = createBox(true, 'sanket-notif-card', {
            x_expand: true,
            y_expand: true,
            reactive: true,
        });

        this._card = createBox(true, 'popup-menu sanket-notif-island', {visible: false});
        this._card.add_child(this._panel);

        this._layout = new IslandLayout(this._menu);
        this._holder = new St.Widget({width: 0, height: 0, layout_manager: this._layout});
        this._holder.add_child(this._card);
        this._overlay.insert_child_at_index(this._holder, 0);

        this._bindings = [
            this._boxPointer.bind_property('opacity', this._card, 'opacity', GObject.BindingFlags.SYNC_CREATE),
            ...FOLLOWED_PROPERTIES.map(property =>
                this._boxPointer.bind_property(property, this._holder, property, GObject.BindingFlags.SYNC_CREATE)),
        ];

        this._boxPointer.connectObject('destroy', () => this._clearBindings(), this);
        this._holder.connectObject('destroy', () => this._clearBindings(), this);
    }

    _adoptMessageList() {
        this._messageExpand = [this._messageList.x_expand, this._messageList.y_expand];
        this._restoreMessageList = detachActor(this._messageList);

        this._placeholder = this._messageList._placeholder;
        if (this._placeholder) {
            this._placeholder.hide();
            this._placeholder.connectObject('notify::visible', () => {
                if (this._placeholder.visible)
                    this._placeholder.hide();
            }, this);
        }

        this._messageList.x_expand = true;
        this._messageList.y_expand = true;
        this._panel.add_child(this._messageList);
        this._setCaptureContainer(this._menu.actor);

        this._scrollbar = new ScrollbarAutoHide(this._messageList._scrollView,
            this._settings.get_string('scrollbar-mode'));
        this._settings.connectObject('changed::scrollbar-mode',
            () => this._scrollbar.setMode(this._settings.get_string('scrollbar-mode')), this);
    }

    _releaseMessageList() {
        if (isActorAlive(this._placeholder)) {
            this._placeholder.disconnectObject(this);
            this._placeholder.show();
        }
        this._placeholder = null;

        if (this._dateMenu && this._dateMenu.menu && isActorAlive(this._dateMenu.menu.actor))
            this._setCaptureContainer(this._dateMenu.menu.actor);
        if (isActorAlive(this._messageList))
            [this._messageList.x_expand, this._messageList.y_expand] = this._messageExpand;
        if (this._restoreMessageList)
            this._restoreMessageList();
        this._restoreMessageList = null;
        this._messageExpand = null;
    }

    _setCaptureContainer(actor) {
        if (isActorAlive(this._messageList) && this._messageList.setCaptureContainer)
            this._messageList.setCaptureContainer(actor);
    }

    _centerControls() {
        this._clearButton = this._messageList._clearButton;
        this._controls = this._clearButton.get_parent();
        this._controlsAlign = [this._controls.x_align, this._controls.x_expand];
        this._clearAlign = [this._clearButton.x_align, this._clearButton.x_expand, this._clearButton.y_align];

        this._controls.x_align = Clutter.ActorAlign.FILL;
        this._controls.x_expand = true;
        this._clearButton.add_style_class_name(PILL_CLASS);
        this._clearButton.x_align = Clutter.ActorAlign.START;
        this._clearButton.y_align = Clutter.ActorAlign.CENTER;
        this._clearButton.x_expand = true;

        this._hiddenControls = this._controls.get_children().filter(child =>
            child !== this._clearButton && child.visible);
        this._hiddenControls.forEach(child => child.hide());

        this._pill.x_expand = true;
        this._pill.x_align = Clutter.ActorAlign.END;
        this._pill.y_align = Clutter.ActorAlign.CENTER;
        this._controls.add_child(this._pill);
    }

    _restoreControls() {
        if (isActorAlive(this._controls) && isActorAlive(this._pill) && this._pill.get_parent() === this._controls)
            this._controls.remove_child(this._pill);
        if (isActorAlive(this._pill))
            this._pill.destroy();
        if (isActorAlive(this._controls)) {
            [this._controls.x_align, this._controls.x_expand] = this._controlsAlign;
            this._controls.show();
        }
        if (isActorAlive(this._clearButton)) {
            [this._clearButton.x_align, this._clearButton.x_expand, this._clearButton.y_align] = this._clearAlign;
            this._clearButton.remove_style_class_name(PILL_CLASS);
            this._clearButton.show();
        }
        this._hiddenControls.filter(isActorAlive).forEach(child => child.show());

        this._hiddenControls = null;
        this._clearAlign = null;
        this._clearButton = null;
        this._controls = null;
    }

    _followTheme() {
        this._gutterActors = [this._messageView || this._messageList._sectionList, this._controls];
        this._gutterStyles = this._gutterActors.map(actor => actor.style);

        this._qsBox.connectObject('notify::style-class', () => this._syncCardClass(), this);
        this._panel.connectObject('style-changed', () => this._syncGutter(), this);
        this._syncCardClass();
        this._syncGutter();
    }

    _syncCardClass() {
        this._panel.style_class = `${this._qsBox.style_class} ${CARD_CLASS}`;
    }

    _syncGutter() {
        const rtl = this._panel.get_text_direction() === Clutter.TextDirection.RTL;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const padding = this._panel.get_theme_node().get_padding(rtl ? St.Side.RIGHT : St.Side.LEFT);
        const style = `margin-${rtl ? 'left' : 'right'}: ${Math.round(padding / scale)}px;`;
        this._gutterActors.forEach(actor => {
            actor.style = style;
        });
    }

    _restoreTheme() {
        this._qsBox.disconnectObject(this);
        this._panel.disconnectObject(this);
        this._gutterActors.forEach((actor, index) => {
            if (isActorAlive(actor))
                actor.style = this._gutterStyles[index];
        });

        this._gutterActors = null;
        this._gutterStyles = null;
    }

    _connectSignals() {
        const sync = () => this._queueSync();

        this._menu.connectObject('open-state-changed', (_menu, open) => this._onOpenStateChanged(open), this);
        this._boxPointer.connectObject('queue-relayout', () => this._holder.queue_relayout(), this);
        this._lists.forEach(list => list.connectObject(CHILD_ADDED, sync, CHILD_REMOVED, sync, this));

        Main.messageTray.connectObject(
            'source-added', (_tray, source) => this._watchSource(source),
            'source-removed', sync,
            this);
        Main.messageTray.getSources().forEach(source => this._watchSource(source));
    }

    _watchSource(source) {
        source.connectObject('notification-added',
            (_source, notification) => this._watchNotification(notification), this);
        source.notifications.forEach(notification => this._watchNotification(notification));
    }

    _watchNotification(notification) {
        notification.connectObject('destroy', () => this._queueSync(), this);
        this._queueSync();
    }

    _onOpenStateChanged(open) {
        if (!open)
            return;

        this._applyExpanded(false);
        this._scrollbar.reset();
        this._sync(false);
    }

    _onMessagesChanged() {
        this._queueSync();
        this._timers.remove(this._settleId);
        this._settleId = this._timers.addTimeout(GLib.PRIORITY_DEFAULT, scaled(SETTLE_DELAY), () => {
            this._settleId = 0;
            this._queueSync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyExpanded(expanded) {
        this._expanded = expanded;
        if (expanded)
            return;

        this._decorator.unexpandAll();
        if (this._messageView && this._messageView.collapse)
            this._messageView.collapse();
    }

    _queueSync() {
        if (this._syncId)
            return;

        this._syncId = this._timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            this._sync(this._menu.isOpen);
            return GLib.SOURCE_REMOVE;
        });
    }

    _needsCompact() {
        const [, panelHeight] = this._panel.get_preferred_height(this._qsBox.width);
        return this._compactToggles.fullHeight + this._layout.gap + panelHeight > this._layout.stackRoom();
    }

    _scan() {
        const messages = this._messageView
            ? [...this._messageView.messages]
            : this._lists.flatMap(list => list.get_children()).map(wrapper => wrapper.child);
        const media = [];
        const groups = [];

        for (const message of messages) {
            const wrapper = message.get_parent();
            if (message.constructor.name === 'MediaMessage')
                media.push(wrapper);
            else
                groups.push({wrapper, message});
        }

        return {media, groups};
    }

    _sync(animate) {
        const {media, groups} = this._scan();
        const visible = media.length + groups.length > 0;

        if (groups.length === 0 && this._expanded)
            this._applyExpanded(false);

        const {hidden, reveals} = this._syncGroups(groups, animate);
        this._syncPill(hidden, animate);

        const showControls = visible && this._pill.visible;
        this._clearButton.visible = showControls;
        this._controls.visible = showControls;

        this._compactToggles.setActive(visible && this._needsCompact(), animate);
        reveals.forEach(reveal => this._reveal(reveal));
        this._syncCard(visible, animate);
    }

    _syncGroups(groups, animate) {
        const hasPinned = groups.some(({message}) => this._decorator.isPinned(message));
        const reveals = [];
        let hidden = 0;

        groups.forEach(group => {
            const {wrapper, message} = group;
            if (!this._trackedGroups.has(message)) {
                this._trackedGroups.add(message);
                message.connectObject('notify::expanded', () => this._onMessagesChanged(), this);
            }
            this._decorator.decorate(message);

            const pinned = this._decorator.isPinned(message);
            const shown = this._expanded || pinned || (!hasPinned && group === groups[0]);
            const wasShown = this._groupShown.has(wrapper) ? this._groupShown.get(wrapper) : wrapper.visible;
            this._groupShown.set(wrapper, shown);
            hidden += shown ? (message.expanded ? 0 : stackSize(message) - 1) : stackSize(message);

            if (!animate) {
                this._stopReveal(wrapper);
                setShown(wrapper, shown);
            } else if (shown !== wasShown) {
                reveals.push({
                    wrapper,
                    shown,
                    scale: wrapper.visible ? wrapper.scale_y : 0,
                    opacity: wrapper.visible ? wrapper.opacity : 0,
                });
                this._stopReveal(wrapper);
                setShown(wrapper, shown);
            }
        });

        return {hidden: this._expanded ? 0 : hidden, reveals};
    }

    _reveal({wrapper, shown, scale, opacity}) {
        wrapper.set_pivot_point(0.5, 0);
        setShown(wrapper, true);
        wrapper.scale_y = scale;
        wrapper.opacity = opacity;

        easeTo(wrapper, {scale_y: shown ? 1 : 0, opacity: shown ? 255 : 0}, () => {
            this._reveals.delete(wrapper);
            if (!shown) {
                setShown(wrapper, false);
                wrapper.scale_y = 1;
                wrapper.opacity = 255;
            }
        }, REVEAL_DURATION, REVEAL_MODE);

        this._reveals.set(wrapper, {
            scale: wrapper.get_transition('scale-y'),
            opacity: wrapper.get_transition('opacity'),
        });
    }

    _stopReveal(wrapper) {
        const transitions = this._reveals.get(wrapper);
        if (!transitions)
            return;

        this._reveals.delete(wrapper);
        if (wrapper.get_transition('scale-y') === transitions.scale) {
            wrapper.remove_transition('scale-y');
            wrapper.scale_y = 1;
        }
        if (wrapper.get_transition('opacity') === transitions.opacity) {
            wrapper.remove_transition('opacity');
            wrapper.opacity = 255;
        }
    }

    _syncPill(hidden, animate) {
        const rtl = this._pill.get_text_direction() === Clutter.TextDirection.RTL;
        const angle = this._expanded ? (rtl ? PILL_ANGLE : -PILL_ANGLE) : 0;
        const text = this._expanded
            ? _('Show Less')
            : ngettext('%d More Notification', '%d More Notifications', hidden).format(hidden);

        this._pill.visible = this._expanded || hidden > 0;
        this._setPillText(text, animate && this._pill.mapped);

        if (animate)
            rotateTo(this._pillIcon, angle, PILL_ROTATE_DURATION, PILL_ROTATE_MODE);
        else
            stopRotation(this._pillIcon, angle);
    }

    _setPillText(text, animate) {
        if (this._pillText === text)
            return;

        this._pillText = text;
        const label = this._pillLabel;

        if (animate) {
            easeTo(label, {opacity: 0, translation_y: -PILL_TEXT_SHIFT}, () => this._showPillText(),
                PILL_TEXT_OUT_DURATION, Clutter.AnimationMode.EASE_IN_QUAD);
        } else {
            label.remove_all_transitions();
            label.set({text, width: -1, opacity: 255, translation_y: 0});
        }
    }

    _showPillText() {
        const label = this._pillLabel;
        const fromWidth = label.natural_width_set ? label.natural_width : label.get_allocation_box().get_width();

        label.width = -1;
        label.text = this._pillText;
        const [, toWidth] = label.get_preferred_width(-1);
        label.set({width: fromWidth, translation_y: PILL_TEXT_SHIFT});

        easeTo(label, {width: toWidth, opacity: 255, translation_y: 0}, () => {
            label.width = -1;
        }, PILL_TEXT_IN_DURATION, MODE);
    }

    _syncCard(visible, animate) {
        if (!animate) {
            this._cardShown = visible;
            stopFade(this._panel);
            this._panel.remove_transition('translation-y');
            this._panel.translation_y = 0;
            this._card.visible = visible;
        } else if (visible !== this._cardShown) {
            this._cardShown = visible;
            if (visible)
                this._showCard();
            else
                this._hideCard();
        }
    }

    _showCard() {
        if (!this._card.visible) {
            this._panel.opacity = 0;
            this._panel.translation_y = -CARD_SHIFT;
            this._card.show();
        }
        easeTo(this._panel, {opacity: 255, translation_y: 0});
    }

    _hideCard() {
        easeTo(this._panel, {opacity: 0, translation_y: -CARD_SHIFT}, () => {
            this._card.hide();
            this._panel.translation_y = 0;
            this._panel.opacity = 255;
        }, FAST_DURATION, Clutter.AnimationMode.EASE_OUT_QUAD);
    }
}