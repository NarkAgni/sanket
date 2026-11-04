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
import {PinnedStore} from '../shell/PinnedStore.js';
import {MessageDecorator} from '../shell/MessageDecorator.js';
import {CHILD_ADDED, CHILD_REMOVED, createBox, detachActor, hasClass, isActorAlive} from '../lib/Utils.js';
import {
    DURATION, FAST_DURATION, HeightAnimator, MODE, MORPH_DURATION, MORPH_MODE, centerPivot, easeTo, jiggle, rotateTo,
    scaled, stopFade, stopRotation,
} from './Animations.js';


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
const CLEAR_CLASS = 'message-list-clear-button';
const MERGED_CLASS = 'sanket-notif-merged';
const CONTROLS_TOP_CLASS = 'sanket-controls-top';
const CALENDAR_CLASS = 'sanket-notif-calendar';
const EDGE_INSET = 2;
const PEEK_ALPHA = [0.7, 0.4];
const PEEK_INSET = 10;
const MIN_RADIUS = 6;
const DEPART_DURATION = 260;
const PINNED_SHOWN = 2;
const TOAST_TIMEOUT = 2400;

function findCard(actor) {
    if (!actor.visible)
        return null;
    if (hasClass(actor, 'message'))
        return actor;

    for (const child of actor.get_children()) {
        const card = findCard(child);
        if (card)
            return card;
    }
    return null;
}

function findMessages(actor, found = []) {
    for (const child of actor.get_children()) {
        if (hasClass(child, 'message'))
            found.push(child);
        else
            findMessages(child, found);
    }
    return found;
}

function insetIn(actor, container) {
    const side = actor.get_text_direction() === Clutter.TextDirection.RTL ? St.Side.RIGHT : St.Side.LEFT;
    let inset = 0;
    let child = actor;
    while (child !== container) {
        const parent = child.get_parent();
        if ('get_theme_node' in child)
            inset += child.get_theme_node().get_margin(side);
        if ('get_theme_node' in parent) {
            const node = parent.get_theme_node();
            inset += node.get_padding(side) + node.get_border_width(side);
        }
        child = parent;
    }
    return inset;
}

function isRounded(actor) {
    return 'get_theme_node' in actor && actor.get_theme_node().get_border_radius(St.Corner.TOPLEFT) > 0;
}

const CardLayout = GObject.registerClass(
class CardLayout extends Clutter.BoxLayout {
    _init() {
        super._init({orientation: Clutter.Orientation.VERTICAL});
        this._maxHeight = -1;
    }

    setMaxHeight(height) {
        if (this._maxHeight === height)
            return;

        this._maxHeight = height;
        this.layout_changed();
    }

    get maxHeight() {
        return this._maxHeight;
    }

    vfunc_get_preferred_height(container, forWidth) {
        const [min, natural] = super.vfunc_get_preferred_height(container, forWidth);
        if (this._maxHeight < 0)
            return [min, natural];
        return [Math.min(min, this._maxHeight), Math.min(natural, this._maxHeight)];
    }
});

function stackSize(message) {
    return message._notificationToMessage ? message._notificationToMessage.size : 1;
}

function heightAt(group, expansion, width) {
    const layout = group.layout_manager;
    const current = layout.expansion;
    layout.expansion = expansion;
    const [, height] = group.get_preferred_height(width);
    layout.expansion = current;
    return height;
}

function setShown(wrapper, shown) {
    wrapper.visible = shown;
    wrapper.set_height(shown ? -1 : 0);
}

export class NotificationIsland {
    constructor(menu, dateMenu, compactToggles, calendarPanel, settings) {
        this._menu = menu;
        this._calendarPanel = calendarPanel;
        this._inCalendar = false;
        this._settings = settings;
        this._dateMenu = dateMenu;
        this._compactToggles = compactToggles;
        this._boxPointer = menu._boxPointer;
        this._qsBox = menu.box;

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
        this._warmId = 0;
        this._stackShown = false;
        this._paintOwner = {};
        this._stackKey = '';
        this._roundedParent = null;
        this._styled = new Set();
        this._departing = new WeakSet();
        this._departures = new Set();
        this._scrolling = false;
        this._cardRoom = 0;
        this._collapsedHeight = 0;
        this._readLayout();
        this._controlsTop = false;

        this._toast = null;
        this._toastId = 0;
        this._store = new PinnedStore(settings);
        this._decorator = new MessageDecorator(this._messageList, this._store,
            () => this._onMessagesChanged(), card => this._showToast(card));

        this._buildActors();
        this._adoptMessageList();
        this._centerControls();
        this._placeCard();
        this._followTheme();
        this._connectSignals();
        this._decorator.pinRestored(this._store.restore());
        this._sync(false);
    }

    setExpanded(expanded) {
        this._applyExpanded(expanded);
        this._sync(true);
        if (expanded)
            this._expandLoneGroup();
    }

    _expandLoneGroup() {
        const {groups} = this._scan();
        if (this._messageView && groups.length === 1 && !groups[0].message.expanded)
            groups[0].message.emit('expand-toggle-requested');
    }

    _clearBindings() {
        if (!this._bindings)
            return;
        this._bindings.forEach(binding => binding.unbind());
        this._bindings = null;
    }

    destroy() {
        global.stage.disconnectObject(this._paintOwner);
        this._compactToggles.resizing.forEach(actor => actor.disconnectObject(this));
        this._compactToggles.disconnectObject(this);
        this._timers.destroy();
        this._clearBindings();
        this._settings.disconnectObject(this);

        this._menu.disconnectObject(this);
        this._menu._overlay.disconnectObject(this);
        this._dateMenu.menu.disconnectObject(this);
        this._boxPointer.disconnectObject(this);
        this._messageList._scrollView.disconnectObject(this);
        this._messageList._scrollView.child.disconnectObject(this);

        this._lists.forEach(list => list.disconnectObject(this));
        Main.messageTray.disconnectObject(this);
        for (const source of Main.messageTray.getSources()) {
            source.disconnectObject(this);
            source.notifications.forEach(notification => notification.disconnectObject(this));
        }

        this._finishDepartures();
        this._scan().groups.forEach(({wrapper, message}) => {
            message.disconnectObject(this);
            if (isActorAlive(message._unexpandButton))
                message._unexpandButton.show();
            this._stopReveal(wrapper);
            setShown(wrapper, true);
        });
        this._styled.forEach(message => {
            message.disconnectObject(this);
            message.style = null;
        });
        this._styled.clear();

        this._decorator.destroy();
        this._store.destroy();
        if (this._toast)
            this._toast.destroy();
        this._scrollbar.destroy();
        this._restoreTheme();
        this._restoreControls();
        this._releaseMessageList();
        this._compactToggles.setExcluded(null);
        this._cardHeight.stop();
        if (this._calendarPanel.notifications)
            this._calendarPanel.setNotifications(null);
        this._card.destroy();
        this._holder.destroy();

        this._decorator = null;
        this._store = null;
        this._toast = null;
        this._scrollbar = null;
        this._layout = null;
        this._holder = null;
        this._card = null;
        this._cardHeight = null;
        this._cardLayout = null;
        this._separator = null;
        this._panel = null;
        this._pill = null;
        this._pillRow = null;
        this._groupButton = null;
        this._groupLabel = null;
        this._pillLabel = null;
        this._pillIcon = null;
        this._lists = null;
        this._trackedGroups = null;
        this._styled = null;
        this._roundedParent = null;
        this._departing = null;
        this._departures = null;
        this._groupShown = null;
        this._reveals = null;
        this._messageView = null;
        this._messageList = null;
        this._qsBox = null;
        this._boxPointer = null;
        this._compactToggles = null;
        this._calendarPanel = null;
        this._slot = null;
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
            style_class: `button flat ${PILL_CLASS}`,
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            child: pillContent,
        });
        this._pill.connectObject('clicked', () => this.setExpanded(!this._expanded), this);

        this._groupLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        const groupContent = createBox(false, 'sanket-more-pill-content');
        groupContent.add_child(this._groupLabel);
        groupContent.add_child(new St.Icon({
            icon_name: 'group-collapse-symbolic',
            icon_size: 14,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._groupButton = new St.Button({
            style_class: `button flat ${PILL_CLASS}`,
            can_focus: true,
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: _('Collapse'),
            child: groupContent,
        });
        this._groupButton.connectObject('clicked', () => this._messageView.collapse(), this);

        this._pillRow = createBox(false, 'sanket-pill-row', {
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pillRow.add_child(this._groupButton);
        this._pillRow.add_child(this._pill);

        this._panel = createBox(true, 'sanket-notif-card', {
            x_expand: true,
            y_expand: true,
            reactive: true,
        });

        this._separator = new St.Bin({
            style_class: 'popup-separator-menu-item sanket-merged-separator',
            x_expand: true,
            child: new St.Widget({style_class: 'popup-separator-menu-item-separator', x_expand: true}),
        });

        this._cardLayout = new CardLayout();
        this._slot = {
            actor: null,
            naturalHeight: width => {
                const height = this._panel.get_preferred_height(width - this._cardPadding(true))[1] + this._cardPadding();
                if (!this._expanded)
                    this._collapsedHeight = height;
                return height;
            },
            collapsedHeight: () => this._collapsedHeight,
            setMaxHeight: height => this._cardLayout.setMaxHeight(Math.max(height - this._cardPadding(), 0)),
        };
        this._card = new St.Widget({style_class: 'sanket-notif-island', visible: false, layout_manager: this._cardLayout});
        this._card.add_child(this._separator);
        this._card.add_child(this._panel);
        this._cardHeight = new HeightAnimator(this._card, MORPH_DURATION, MORPH_MODE);
        this._clipEdge = 0;
        this._card.connectObject('notify::allocation', () => {
            this._syncClip();
        }, this);

        this._layout = new IslandLayout(this._menu);
        this._holder = new St.Widget({width: 0, height: 0, layout_manager: this._layout});
        this._attachHolder();
        this._menu._overlay.connectObject('notify::has-clip', () => this._attachHolder(), this);
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

        this._stack = createBox(true, 'sanket-stack', {visible: false, x_expand: true});
        this._peeks = [0, 1].map(index => {
            const peek = new St.Widget({style_class: `sanket-stack-peek sanket-stack-peek-${index + 1}`, x_expand: true});
            this._stack.add_child(peek);
            return peek;
        });
        this._messageList._scrollView.get_parent().insert_child_above(this._stack, this._messageList._scrollView);
        this._stackAnchor = null;

        this._scrollbar = new ScrollbarAutoHide(this._messageList._scrollView,
            this._settings.get_string('scrollbar-mode'));
        [this._messageList._scrollView, this._messageList._scrollView.child].forEach(actor =>
            actor.connectObject('notify::allocation', () => this._syncScrolling(), this));
        this._settings.connectObject(
            'changed::scrollbar-mode', () => this._scrollbar.setMode(this._settings.get_string('scrollbar-mode')),
            'changed::compact-mode', () => this._queueSync(),
            'changed::compact-layout', () => this._queueSync(),
            'changed::notification-layout', () => this._onLayoutChanged(),
            'changed::keep-pinned', () => this._onKeepChanged(),
            this);
    }

    _onKeepChanged() {
        if (this._store.enabled)
            this._decorator.keepHeld();
        else
            this._store.clear();
    }

    _releaseMessageList() {
        this._stackAnchor = null;
        this._stack.destroy();
        this._stack = null;
        this._peeks = null;

        if (isActorAlive(this._placeholder)) {
            this._placeholder.disconnectObject(this);
            this._placeholder.show();
        }
        this._placeholder = null;

        this._setCaptureContainer(this._dateMenu.menu.actor);
        [this._messageList.x_expand, this._messageList.y_expand] = this._messageExpand;
        this._restoreMessageList();
        this._restoreMessageList = null;
        this._messageExpand = null;
    }

    _setCaptureContainer(actor) {
        if (this._messageList.setCaptureContainer)
            this._messageList.setCaptureContainer(actor);
    }

    _centerControls() {
        this._clearButton = this._messageList._clearButton;
        this._controls = this._clearButton.get_parent();
        this._controlsIndex = this._controls.get_parent().get_children().indexOf(this._controls);
        this._controlsAlign = [this._controls.x_align, this._controls.x_expand];
        this._clearAlign = [this._clearButton.x_align, this._clearButton.x_expand, this._clearButton.y_align];

        this._controls.x_align = Clutter.ActorAlign.FILL;
        this._controls.x_expand = true;
        this._clearButton.remove_style_class_name(CLEAR_CLASS);
        this._clearButton.add_style_class_name('flat');
        this._clearButton.add_style_class_name(PILL_CLASS);
        this._clearButton.x_align = Clutter.ActorAlign.START;
        this._clearButton.y_align = Clutter.ActorAlign.CENTER;
        this._clearButton.x_expand = true;
        this._clearButton.connectObject('clicked', () => this._onClearClicked(), this);
        this._collapseGesture = this._messageList._clickGesture || null;
        if (this._collapseGesture)
            this._collapseGesture.connectObject('may-recognize', () => !this._onControls(this._collapseGesture), this);

        this._hiddenControls = this._controls.get_children().filter(child =>
            child !== this._clearButton && child.visible);
        this._hiddenControls.forEach(child => child.hide());

        this._pill.y_align = Clutter.ActorAlign.CENTER;
        this._controls.add_child(this._pillRow);
    }

    _onControls(gesture) {
        const target = global.stage.get_event_actor(gesture.get_point_event(0));
        return Boolean(target) && isActorAlive(this._controls) && this._controls.contains(target);
    }

    _restoreControls() {
        if (this._collapseGesture)
            this._collapseGesture.disconnectObject(this);
        this._collapseGesture = null;
        if (isActorAlive(this._controls) && isActorAlive(this._pillRow) && this._pillRow.get_parent() === this._controls)
            this._controls.remove_child(this._pillRow);
        if (isActorAlive(this._pillRow))
            this._pillRow.destroy();
        if (isActorAlive(this._controls)) {
            this._controls.get_parent().set_child_at_index(this._controls, this._controlsIndex);
            [this._controls.x_align, this._controls.x_expand] = this._controlsAlign;
            this._controls.show();
        }
        if (isActorAlive(this._clearButton)) {
            this._clearButton.disconnectObject(this);
            [this._clearButton.x_align, this._clearButton.x_expand, this._clearButton.y_align] = this._clearAlign;
            this._clearButton.remove_style_class_name(PILL_CLASS);
            this._clearButton.remove_style_class_name('flat');
            this._clearButton.add_style_class_name(CLEAR_CLASS);
            this._clearButton.show();
        }
        this._hiddenControls.filter(isActorAlive).forEach(child => child.show());

        this._hiddenControls = null;
        this._controlsIndex = 0;
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

    _attachHolder() {
        const overlay = this._menu._overlay;
        const parent = this._holder.get_parent();
        const target = overlay.has_clip ? this._menu.actor : overlay;
        if (parent === target)
            return;

        if (parent)
            parent.remove_child(this._holder);
        if (target === overlay)
            overlay.insert_child_at_index(this._holder, 0);
        else
            this._menu.actor.insert_child_below(this._holder, overlay);
        this._syncBindings();
    }

    _syncBindings() {
        this._clearBindings();
        const inOverlay = this._holder.get_parent() === this._menu._overlay;
        if (inOverlay)
            this._holder.set_translation(0, 0, 0);

        const properties = inOverlay ? ['opacity'] : ['opacity', ...FOLLOWED_PROPERTIES];
        this._bindings = properties.map(property =>
            this._boxPointer.bind_property(property, this._holder, property, GObject.BindingFlags.SYNC_CREATE));
    }

    _readLayout() {
        const layout = this._settings.get_string('notification-layout');
        this._merged = layout === 'merged';
        this._inCalendar = layout === 'calendar';
    }

    _placeCard() {
        this._roundedParent = null;
        this._slot.actor = this._card;
        if (this._inCalendar) {
            if (this._calendarPanel.notifications !== this._slot) {
                const parent = this._card.get_parent();
                if (parent)
                    parent.remove_child(this._card);
                this._calendarPanel.setNotifications(this._slot);
            }
            this._card.style_class = `sanket-notif-island ${CALENDAR_CLASS}`;
            this._panel.y_expand = false;
            this._separator.visible = false;
            this._syncControlsSide(false);
            this._compactToggles.setExcluded(null);
            this._setCaptureContainer(this._dateMenu.menu.actor);
            return;
        }

        if (this._calendarPanel.notifications)
            this._calendarPanel.setNotifications(null);
        this._panel.y_expand = true;
        this._setCaptureContainer(this._menu.actor);

        const above = this._layout.opensUpward();
        const target = this._merged ? this._qsBox : this._holder;
        const last = this._merged && !above;
        const parent = this._card.get_parent();
        const children = target.get_children();

        const moved = parent !== target || children.indexOf(this._card) !== (last ? children.length - 1 : 0);
        if (moved) {
            if (parent)
                parent.remove_child(this._card);
            target.insert_child_at_index(this._card, last ? -1 : 0);
        }

        this._card.style_class = this._merged
            ? `sanket-notif-island ${MERGED_CLASS} ${above ? 'sanket-merged-above' : 'sanket-merged-below'}`
            : 'popup-menu sanket-notif-island';
        this._separator.visible = this._merged && above;
        this._card.set_child_at_index(this._separator, last ? 0 : 1);
        this._syncControlsSide(last);
        this._compactToggles.setExcluded(this._merged ? this._card : null);
    }

    _cardPadding(horizontal = false) {
        const node = this._card.get_theme_node();
        return horizontal
            ? node.get_padding(St.Side.LEFT) + node.get_padding(St.Side.RIGHT)
            : node.get_padding(St.Side.TOP) + node.get_padding(St.Side.BOTTOM);
    }


    _syncClip() {
        if (!this._merged && !this._inCalendar) {
            this._card.remove_clip();
            return;
        }

        const rtl = this._card.get_text_direction() === Clutter.TextDirection.RTL;
        const box = this._card.allocation;
        this._card.set_clip(rtl ? -this._clipEdge : 0, 0, box.get_width() + this._clipEdge, box.get_height());
    }

    _syncControlsSide(top) {
        this._controls.get_parent().set_child_at_index(this._controls, top ? 0 : this._controlsIndex);
        this._controlsTop = top;
        this._syncCardClass();
    }

    _mergedGap() {
        const node = this._card.get_theme_node();
        return this._qsBox.layout_manager.spacing + node.get_margin(St.Side.TOP) + node.get_margin(St.Side.BOTTOM);
    }

    _onLayoutChanged() {
        this._roundedParent = null;
        this._readLayout();
        this._placeCard();
        this._syncGutter();
        this._syncScrolling();
        this._queueSync();
    }

    _syncCardClass() {
        this._panel.style_class = [
            this._merged || this._inCalendar ? '' : this._qsBox.style_class,
            CARD_CLASS,
            this._controlsTop ? CONTROLS_TOP_CLASS : '',
        ].filter(Boolean).join(' ');
    }

    _syncGutter() {
        const rtl = this._panel.get_text_direction() === Clutter.TextDirection.RTL;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const end = rtl ? St.Side.LEFT : St.Side.RIGHT;
        const padding = this._merged || this._inCalendar ? 0 : this._panel.get_theme_node().get_padding(rtl ? St.Side.RIGHT : St.Side.LEFT);
        const side = rtl ? 'left' : 'right';
        const gutter = this._scrolling ? this._scrollbar.barWidth : padding;
        const [view, controls] = this._gutterActors;
        view.style = `margin-${side}: ${Math.round(gutter / scale)}px;`;
        controls.style = `margin-${side}: ${Math.round(padding / scale)}px;`;

        const edge = this._merged
            ? Math.max(this._qsBox.get_theme_node().get_padding(end) - EDGE_INSET * scale, 0)
            : 0;

        this._clipEdge = edge;
        this._stackKey = '';
        this._scrollbar.setOffset(rtl ? -edge : edge);
        this._syncClip();
        this._syncInset();
        this._applyRadius();
    }

    _syncInset() {
        const card = this._merged || this._inCalendar || this._controls.visible ? null : findCard(this._messageList);
        if (!card) {
            this._panel.style = null;
            return;
        }

        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const top = this._panel.get_theme_node().get_padding(St.Side.TOP);
        const inset = Math.max(top - card.get_theme_node().get_margin(St.Side.BOTTOM), 0);
        this._panel.style = `padding-bottom: ${Math.round(inset / scale)}px;`;
    }

    _syncScrolling() {
        const {upper, page_size: pageSize} = this._scrollbar.adjustment;
        const scrolling = this._inCalendar && upper > pageSize + 1;
        if (scrolling === this._scrolling)
            return;

        this._scrolling = scrolling;
        this._calendarPanel.setScrolling(scrolling);
        this._syncGutter();
    }

    _syncCardHeight() {
        this._cardRoom = this._merged
            ? this._layout.menuRoom() - this._mergedGap() - this._compactToggles.contentHeight
            : 0;
        this._applyCardHeight();
    }

    _applyCardHeight() {
        if (this._merged)
            this._cardLayout.setMaxHeight(Math.max(this._cardRoom - this._compactToggles.regionOffset, 0));
        else if (!this._inCalendar)
            this._cardLayout.setMaxHeight(-1);
    }

    _queueWarm() {
        if (this._warmId)
            return;

        this._warmId = this._timers.addIdle(GLib.PRIORITY_LOW, () => {
            this._warmId = 0;
            this._scan().groups
                .filter(({wrapper}) => !wrapper.visible)
                .forEach(({wrapper}) => wrapper.get_preferred_height(wrapper.get_parent().allocation.get_width()));
            return GLib.SOURCE_REMOVE;
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

        this._menu.connectObject('open-state-changed', (_menu, open) => {
            if (!this._inCalendar)
                this._onOpenStateChanged(open);
        }, this);
        this._dateMenu.menu.connectObject('open-state-changed', (_menu, open) => {
            if (this._inCalendar)
                this._onOpenStateChanged(open);
        }, this);
        this._compactToggles.resizing.forEach(actor =>
            actor.connectObject('notify::height', () => this._applyCardHeight(), this));
        this._compactToggles.connectObject('demand-changed', () => this._sync(this._menu.isOpen), this);
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
        global.stage.disconnectObject(this._paintOwner);
        if (!open) {
            this._finishDepartures();
            this._hideToast(false);
            return;
        }

        global.stage.connectObject('after-paint', () => this._alignStack(), this._paintOwner);

        this._stackKey = '';
        this._applyExpanded(false);
        this._scrollbar.reset();
        this._placeCard();
        this._sync(false);
        this._queueSync();
        this._queueWarm();
    }

    _onMessagesChanged() {
        this._queueSync();
        this._queueWarm();
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
        const gap = this._merged ? this._mergedGap() + (this._separator.visible ? this._separator.get_preferred_height(-1)[1] : 0) : this._layout.gap;
        const room = this._merged ? this._layout.menuRoom() : this._layout.stackRoom();
        const full = this._compactToggles.fullHeight;
        return full + gap + panelHeight + this._expansionDelta() > room;
    }

    _expansionDelta() {
        if (!this._messageView)
            return 0;

        const expandedGroup = this._messageView.expandedGroup;
        return this._scan().groups
            .filter(({wrapper, message}) => wrapper.visible &&
                message.layout_manager.expansion !== (message === expandedGroup ? 1 : 0))
            .reduce((delta, {message}) => {
                const width = message.allocation.get_width();
                const [, current] = message.get_preferred_height(width);
                const target = this._decorator.measure(() => heightAt(message, message === expandedGroup ? 1 : 0, width));
                return delta + target - current;
            }, 0);
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
        const {media, groups: allGroups} = this._scan();
        const groups = allGroups.filter(({message}) => stackSize(message) > 0 && !this._departing.has(message));
        const visible = media.length + groups.length > 0;

        if (groups.length <= 1 && this._expanded)
            this._applyExpanded(false);

        const {hidden, reveals} = this._syncGroups(groups, animate);
        this._applyRadius();
        this._syncPill(hidden, animate);
        this._setStackAnchor(groups.filter(({wrapper}) => wrapper.visible).at(-1));
        this._syncStack(this._expanded ? 0 : hidden, animate);

        const groupOpen = this._syncGroupButton();
        const showControls = visible && (this._pill.visible || groupOpen);
        this._clearButton.visible = showControls;
        this._controls.visible = showControls;
        this._syncInset();

        const mode = this._settings.get_string('compact-mode');
        const demanded = mode === 'demand' && !this._compactToggles.userExpanded;
        const needed = mode === 'auto' && visible && !this._inCalendar && this._needsCompact();
        this._compactToggles.setActive((mode === 'always' || demanded || needed) && !this._compactToggles.peeking, animate);
        this._syncCardHeight();
        this._syncCard(visible, animate);
        if (this._inCalendar)
            this._calendarPanel.reflow(animate);
        else
            this._layout.layout_changed();

        this._alignStack();
        this._revealsInView(reveals, groups).forEach(reveal => this._reveal(reveal));
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
                if (message._unexpandButton)
                    message._unexpandButton.hide();
            }
            this._decorator.decorate(message);

            const pinned = this._decorator.isPinned(message);
            const shown = this._expanded || (pinned && this._decorator.pinnedRank(message) < PINNED_SHOWN) ||
                (!hasPinned && group === groups[0]);
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

        return {hidden: this._expanded ? 0 : Math.max(hidden, 0), reveals};
    }

    _revealsInView(reveals, groups) {
        const byWrapper = new Map(reveals.map(reveal => [reveal.wrapper, reveal]));
        const {value, page_size: pageSize} = this._scrollbar.adjustment;
        const room = this._merged ? this._cardRoom : this._layout.stackRoom();
        const bottom = value + Math.max(pageSize, this._inCalendar ? this._cardLayout.maxHeight : room);
        const inView = [];
        let y = 0;

        for (const {wrapper} of groups) {
            const reveal = byWrapper.get(wrapper);
            if (y >= bottom)
                break;
            if (!wrapper.visible && !reveal)
                continue;

            const [, height] = wrapper.get_preferred_height(wrapper.get_parent().allocation.get_width());
            if (reveal && y + height > value)
                inView.push(reveal);
            y += height;
        }
        return inView;
    }

    _reveal({wrapper, shown, scale, opacity}) {
        const promoted = shown && !this._expanded;
        wrapper.set_pivot_point(0.5, 0);
        setShown(wrapper, true);
        wrapper.scale_y = promoted ? 1 : scale;
        wrapper.opacity = opacity;

        const target = promoted ? {opacity: 255} : {scale_y: shown ? 1 : 0, opacity: shown ? 255 : 0};
        easeTo(wrapper, target, () => {
            this._reveals.delete(wrapper);
            setShown(wrapper, shown);
            wrapper.scale_y = 1;
            wrapper.opacity = 255;
        }, this._merged ? MORPH_DURATION : REVEAL_DURATION, this._merged ? MORPH_MODE : REVEAL_MODE);

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

    depart(wrapper, finish) {
        const message = wrapper.child;
        if (!this._messageView || this._expanded || message !== this._stackAnchor || !wrapper.mapped)
            return false;

        const next = this._scan().groups.find(group => group.wrapper !== wrapper &&
            stackSize(group.message) > 0 && !this._departing.has(group.message));
        if (!next || next.wrapper.visible)
            return false;

        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const scrollView = this._messageList._scrollView;
        const [viewX, viewY] = scrollView.get_transformed_position();
        const [viewWidth, viewHeight] = scrollView.get_transformed_size();
        const [x, y] = message.get_transformed_position();
        const [width, height] = message.get_transformed_size();

        const frame = new St.Widget({clip_to_allocation: true, x: viewX, y: viewY, width: viewWidth, height: viewHeight});
        const leaving = new Clutter.Clone({source: message, x: x - viewX, y: y - viewY, width, height});
        frame.add_child(leaving);
        Main.layoutManager.uiGroup.add_child(frame);

        const held = this._inCalendar ? -1 : this._card.allocation.get_height();
        if (held >= 0) {
            this._cardHeight.stop();
            this._card.height = held;
        }

        const departure = {frame, finish, held, wrapper, next: next.wrapper};
        this._departures.add(departure);
        this._departing.add(message);
        wrapper.hide();

        this._stopReveal(next.wrapper);
        this._groupShown.set(next.wrapper, true);
        setShown(next.wrapper, true);
        next.wrapper.set_pivot_point(0.5, 0);
        next.wrapper.scale_x = Math.max(width - 2 * PEEK_INSET * scale, 1) / Math.max(width, 1);
        next.wrapper.opacity = 0;
        this._stack.remove_transition('opacity');
        this._stack.opacity = 0;

        easeTo(next.wrapper, {scale_x: 1, opacity: 255}, null, DEPART_DURATION, MODE);
        easeTo(leaving, {opacity: 0}, () => this._endDeparture(departure), DEPART_DURATION, MODE);

        this._sync(true);
        return true;
    }

    _endDeparture(departure) {
        if (!this._departures.delete(departure))
            return;

        departure.frame.destroy();
        if (isActorAlive(departure.next)) {
            departure.next.remove_transition('scale-x');
            departure.next.remove_transition('opacity');
            departure.next.scale_x = 1;
            departure.next.opacity = 255;
        }
        if (isActorAlive(departure.wrapper)) {
            departure.wrapper.set_scale(0, 0);
            departure.wrapper.opacity = 0;
            departure.wrapper.show();
        }
        if (isActorAlive(this._card) && departure.held >= 0) {
            if (this._card.mapped)
                this._cardHeight.animate(departure.held);
            else
                this._cardHeight.stop();
        }
        if (isActorAlive(this._stack))
            easeTo(this._stack, {opacity: 255}, null, FAST_DURATION);
        departure.finish();
    }

    _finishDepartures() {
        [...this._departures].forEach(departure => this._endDeparture(departure));
    }

    _onClearClicked() {
        const cards = this._scan().groups.flatMap(({message}) => this._decorator.pinnedCards(message));
        if (cards.length === 0)
            return;

        cards.forEach(card => jiggle(card));
        if (!this._decorator.clearedOthers)
            this._showToast(cards[0]);
    }

    _showToast(card) {
        if (!this._toast) {
            this._toast = new St.Label({
                style_class: 'sanket-toast',
                text: _('This notification is pinned. Unpin it to clear it.'),
                visible: false,
            });
            Main.layoutManager.uiGroup.add_child(this._toast);
        }

        const [cardX, cardY] = card.get_transformed_position();
        const [cardWidth, cardHeight] = card.get_transformed_size();
        const [, width] = this._toast.get_preferred_width(-1);
        const [, height] = this._toast.get_preferred_height(width);
        const monitor = Main.layoutManager.findMonitorForActor(card);
        const x = cardX + (cardWidth - width) / 2;
        const y = cardY + cardHeight - height / 2;
        const left = monitor ? Math.min(Math.max(x, monitor.x), monitor.x + monitor.width - width) : x;
        const top = monitor ? Math.min(y, monitor.y + monitor.height - height) : y;

        Main.layoutManager.uiGroup.set_child_above_sibling(this._toast, null);
        this._toast.set_position(Math.round(left), Math.round(top));
        if (!this._toast.visible) {
            this._toast.opacity = 0;
            this._toast.show();
        }
        easeTo(this._toast, {opacity: 255}, null, FAST_DURATION);

        this._timers.remove(this._toastId);
        this._toastId = this._timers.addTimeout(GLib.PRIORITY_DEFAULT, scaled(TOAST_TIMEOUT), () => {
            this._toastId = 0;
            this._hideToast(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _hideToast(animate) {
        this._timers.remove(this._toastId);
        this._toastId = 0;
        if (!this._toast || !this._toast.visible)
            return;

        if (animate) {
            easeTo(this._toast, {opacity: 0}, () => this._toast.hide(), FAST_DURATION);
        } else {
            this._toast.remove_transition('opacity');
            this._toast.hide();
        }
    }

    _setStackAnchor(group) {
        this._stackAnchor = group ? group.message : null;
    }

    _roundedContainer() {
        if (!isActorAlive(this._roundedParent) || !isRounded(this._roundedParent)) {
            let actor = this._messageList.get_parent();
            while (actor.get_parent() && !isRounded(actor))
                actor = actor.get_parent();
            this._roundedParent = actor;
        }
        return this._roundedParent;
    }

    _applyRadius() {
        if (!this._messageList.get_stage())
            return;

        const container = this._roundedContainer();
        if (!isRounded(container))
            return;

        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const outer = container.get_theme_node().get_border_radius(St.Corner.TOPLEFT);
        findMessages(this._messageList).forEach(message => {
            const radius = Math.max(outer - insetIn(message, container), MIN_RADIUS * scale);
            const style = `border-radius: ${Math.round(radius / scale)}px;`;
            if (message.style === style)
                return;

            message.style = style;
            if (!this._styled.has(message)) {
                this._styled.add(message);
                message.connectObject('destroy', () => this._styled.delete(message), this);
            }
        });
        this._stackKey = '';
    }

    _alignStack() {
        if (!this._stack.visible || !isActorAlive(this._stackAnchor) || !this._stackAnchor.mapped)
            return;

        const card = findCard(this._stackAnchor) || this._stackAnchor;
        const [anchorX, anchorY] = card.get_transformed_position();
        const [anchorWidth, anchorHeight] = card.get_transformed_size();
        const [stackX, stackY] = this._stack.get_transformed_position();
        const [stackWidth] = this._stack.get_transformed_size();
        if (![anchorX, anchorY, stackX, stackY].every(Number.isFinite) || !(anchorWidth > 0 && stackWidth > 0))
            return;

        const restyle = !card.hover;
        const key = [anchorX, anchorY, anchorWidth, anchorHeight, stackX, stackY, stackWidth, restyle].join();
        if (key === this._stackKey)
            return;

        this._stackKey = key;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const node = card.get_theme_node();
        const {red, green, blue, alpha} = node.get_background_color();
        const radius = Math.round(node.get_border_radius(St.Corner.BOTTOMLEFT) / scale);

        const shift = anchorY + anchorHeight - stackY;
        if (Math.abs(shift) >= 0.5)
            this._stack.translation_y += shift;
        this._peeks.forEach((peek, index) => {
            const inset = PEEK_INSET * (index + 1) * scale;
            const shade = (alpha / 255 * PEEK_ALPHA[index]).toFixed(2);
            peek.margin_left = Math.round(Math.max(anchorX - stackX + inset, 0));
            peek.margin_right = Math.round(Math.max(stackX + stackWidth - anchorX - anchorWidth + inset, 0));
            if (restyle)
                peek.style = `background-color: rgba(${red}, ${green}, ${blue}, ${shade}); border-radius: 0 0 ${radius}px ${radius}px;`;
        });
    }

    _syncStack(hidden, animate) {
        const shown = hidden > 0;
        this._peeks[1].visible = hidden > 1;
        if (shown === this._stackShown) {
            if (shown)
                this._alignStack();
            return;
        }

        this._stackShown = shown;
        this._stackKey = '';

        const [duration, mode] = this._merged || this._inCalendar
            ? [MORPH_DURATION, MORPH_MODE]
            : [REVEAL_DURATION, REVEAL_MODE];
        this._stack.remove_all_transitions();

        if (!animate) {
            this._stack.visible = shown;
            this._stack.height = -1;
            this._stack.opacity = 255;
            if (shown)
                this._alignStack();
            return;
        }

        if (shown) {
            this._stack.opacity = 0;
            this._stack.show();
            this._alignStack();
            easeTo(this._stack, {opacity: 255}, null, duration, mode);
        } else {
            this._stack.hide();
        }
    }

    _syncGroupButton() {
        const group = this._messageView ? this._messageView.expandedGroup : null;
        this._groupButton.visible = Boolean(group);
        if (group)
            this._groupLabel.text = group.source.title;
        return Boolean(group);
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
            this._cardHeight.stop();
            stopFade(this._card);
            this._card.remove_transition('translation-y');
            this._card.translation_y = 0;
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
        this._card.remove_all_transitions();
        const fromHeight = this._card.visible ? this._card.allocation.get_height() : 0;
        if (!this._card.visible) {
            this._card.opacity = 0;
            this._card.translation_y = this._merged || this._inCalendar ? 0 : -CARD_SHIFT;
            this._card.show();
        }

        if (this._merged || this._inCalendar) {
            easeTo(this._card, {opacity: 255}, null, MORPH_DURATION, MORPH_MODE);
            if (this._merged)
                this._cardHeight.animate(fromHeight);
        } else {
            easeTo(this._card, {opacity: 255, translation_y: 0}, null, DURATION, MODE);
        }
    }

    _hideCard() {
        const done = () => {
            this._card.hide();
            this._card.translation_y = 0;
            this._card.opacity = 255;
            this._card.height = -1;
            if (this._inCalendar)
                this._calendarPanel.reflow(true);
        };

        if (this._inCalendar) {
            easeTo(this._card, {opacity: 0}, done, MORPH_DURATION, MORPH_MODE);
        } else if (this._merged) {
            this._cardHeight.stop();
            this._card.height = this._card.allocation.get_height();
            easeTo(this._card, {opacity: 0, height: 0}, done, MORPH_DURATION, MORPH_MODE);
        } else {
            easeTo(this._card, {opacity: 0, translation_y: -CARD_SHIFT}, done, FAST_DURATION,
                Clutter.AnimationMode.EASE_OUT_QUAD);
        }
    }
}