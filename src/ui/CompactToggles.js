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
import Clutter from 'gi://Clutter';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {isToggle} from '../lib/Toggles.js';
import {TimeoutTracker} from '../lib/TimeoutTracker.js';
import {ReorderDrag, slideReorder} from './ReorderDrag.js';
import {CHILD_ADDED, CHILD_REMOVED, childContaining, createBox, isActorAlive} from '../lib/Utils.js';
import {
    HeightAnimator, MORPH_DURATION, MORPH_MODE, centerPivot, easeTo, fadeIn, rotateTo, scaled, stopFade, stopRotation,
} from './Animations.js';


const COMPACT_COLUMNS = 6;
const ICON_SIZE = 16;
const TEXT_CLASSES = ['quick-toggle-title', 'quick-toggle-subtitle'];
const MENU_BUTTON_CLASSES = ['quick-toggle-menu-button', 'quick-toggle-arrow'];
const TEXT_IN_DELAY = 70;
const TEXT_IN_DURATION = 260;
const TEXT_OUT_DURATION = 150;
const TEXT_FADE_MODE = Clutter.AnimationMode.EASE_IN_OUT_QUAD;
const FADE_AWAY_DURATION = 200;

function findChild(actor, match) {
    for (const child of actor.get_children()) {
        if (match(child))
            return child;

        const found = findChild(child, match);
        if (found)
            return found;
    }
    return null;
}

function isIcon(actor) {
    return actor.constructor === St.Icon;
}

function findText(actor, styleClass) {
    return findChild(actor, child =>
        child.constructor === St.Label && child.visible && child.has_style_class_name(styleClass));
}

function isMenuButton(actor) {
    return Boolean(actor.has_style_class_name) && actor.visible &&
        MENU_BUTTON_CLASSES.some(styleClass => actor.has_style_class_name(styleClass));
}

const SLIDER_KEYS = {
    OutputStreamSlider: 'compact-show-volume',
    InputStreamSlider: 'compact-show-volume',
    BrightnessItem: 'compact-show-brightness',
};

function offsetIn(actor, layer) {
    const [x, y] = actor.get_transformed_position();
    const [layerX, layerY] = layer.get_transformed_position();
    return [x - layerX, y - layerY];
}

function shapeOf(shell, icon, layer) {
    const [x, y] = offsetIn(shell, layer);
    const [iconX] = offsetIn(icon, layer);
    const [width, height] = shell.get_transformed_size();
    const [iconWidth] = icon.get_transformed_size();
    const texts = TEXT_CLASSES.map(styleClass => {
        const label = findText(shell, styleClass);
        if (!label)
            return null;

        const [textX, textY] = offsetIn(label, layer);
        return {x: textX - x, y: textY - y};
    });

    const menuButton = findChild(shell, isMenuButton);
    let menu = null;
    if (menuButton) {
        const [menuX] = offsetIn(menuButton, layer);
        const [menuWidth] = menuButton.get_transformed_size();
        menu = {left: menuX - x, right: x + width - menuX - menuWidth};
    }

    return {x, y, width, height, iconCenter: iconX - x + iconWidth / 2, texts, menu};
}

function lerp(from, to, progress) {
    return from + (to - from) * progress;
}

function fitClone(clone, source) {
    const box = source.allocation;
    clone.set_size(box.get_width(), box.get_height());
}

class MorphGhost {
    constructor(layer, item, sourceIcon, shape) {
        this.item = item;
        this.target = null;
        this._layer = layer;
        this._timeline = null;

        this.actor = new St.Widget({
            style_class: 'quick-toggle button sanket-compact-ghost',
            clip_to_allocation: true,
            x: shape.x,
            y: shape.y,
            width: shape.width,
            height: shape.height,
        });
        if (item.checked)
            this.actor.add_style_pseudo_class('checked');

        this._iconSource = sourceIcon;
        this._icon = new Clutter.Clone({source: sourceIcon});
        fitClone(this._icon, sourceIcon);
        this._icon.x = this._iconLeft(shape, this._icon.width);
        this.actor.add_child(this._icon);

        this._texts = TEXT_CLASSES.map((styleClass, index) => {
            const source = findText(item, styleClass);
            const place = shape.texts[index];
            const label = new St.Label({
                style_class: styleClass,
                text: source ? source.text : '',
                x: place ? place.x : this._icon.x,
                y: place ? place.y : 0,
                opacity: place ? 255 : 0,
            });
            this.actor.add_child(label);
            return label;
        });

        this._menuSource = findChild(item, isMenuButton);
        this._menuPlace = shape.menu;
        this._menu = null;
        if (this._menuSource) {
            this._menu = new Clutter.Clone({source: this._menuSource, opacity: shape.menu ? 255 : 0});
            fitClone(this._menu, this._menuSource);
            this.actor.add_child(this._menu);
            this._menuSource.connectObject('notify::allocation', () => this._fitMenu(), this);
        }

        this.actor.connectObject(
            'notify::width', () => this._layout(),
            'notify::height', () => this._layout(),
            this);
        this._iconSource.connectObject('notify::allocation', () => this._fitIcon(), this);
        this._layout();
        layer.add_child(this.actor);
    }

    retarget(shell, icon) {
        this.target = {shell, icon};
    }

    morphTo(shape, onDone) {
        const icon = this._icon;
        const iconLeft = this._iconLeft(shape, icon.width);

        this._texts.forEach((label, index) => {
            const place = shape.texts[index];
            if (place) {
                if (label.opacity === 0) {
                    label.x = icon.x + place.x - iconLeft;
                    label.y = place.y;
                }
                easeTo(label, {x: place.x, y: place.y}, null, MORPH_DURATION, MORPH_MODE);
                easeTo(label, {opacity: 255}, null, TEXT_IN_DURATION, TEXT_FADE_MODE, TEXT_IN_DELAY);
            } else {
                easeTo(label, {x: iconLeft + label.x - icon.x, opacity: 0}, null, TEXT_OUT_DURATION, MORPH_MODE);
            }
        });

        if (this._menu) {
            if (shape.menu) {
                this._menuPlace = shape.menu;
                easeTo(this._menu, {opacity: 255}, null, TEXT_IN_DURATION, TEXT_FADE_MODE, TEXT_IN_DELAY);
            } else {
                easeTo(this._menu, {opacity: 0}, null, TEXT_OUT_DURATION, TEXT_FADE_MODE);
            }
            this._placeMenu();
        }

        easeTo(icon, {x: iconLeft}, null, MORPH_DURATION, MORPH_MODE);
        this._track(shape, onDone);
    }

    _track(shape, onDone) {
        if (this._timeline)
            this._timeline.stop();

        const from = {x: this.actor.x, y: this.actor.y, width: this.actor.width, height: this.actor.height};
        let to = shape;
        const step = progress => {
            const {shell, icon} = this.target;
            if (isActorAlive(shell) && isActorAlive(icon) && shell.mapped && shell.has_allocation())
                to = shapeOf(shell, icon, this._layer);
            this.actor.set_position(lerp(from.x, to.x, progress), lerp(from.y, to.y, progress));
            this.actor.set_size(lerp(from.width, to.width, progress), lerp(from.height, to.height, progress));
        };

        const duration = St.Settings.get().enable_animations ? scaled(MORPH_DURATION) : 0;
        if (duration === 0) {
            step(1);
            onDone();
            return;
        }

        this._timeline = new Clutter.Timeline({actor: this._layer, duration});
        this._timeline.set_progress_mode(MORPH_MODE);
        this._timeline.connect('new-frame', () => step(this._timeline.get_progress()));
        this._timeline.connect('completed', () => {
            step(1);
            this._timeline = null;
            onDone();
        });
        this._timeline.start();
    }

    destroy() {
        if (this._timeline)
            this._timeline.stop();
        [this._iconSource, this._menuSource]
            .filter(isActorAlive)
            .forEach(source => source.disconnectObject(this));
        this._icon.destroy();
        if (this._menu)
            this._menu.destroy();
        this.actor.destroy();
        this.actor = null;
        this._iconSource = null;
        this._menuSource = null;
        this._menuPlace = null;
        this._menu = null;
        this._icon = null;
        this._texts = null;
        this._timeline = null;
        this._layer = null;
        this.target = null;
        this.item = null;
    }

    _iconLeft(shape, iconWidth) {
        return Math.round(shape.iconCenter - iconWidth / 2);
    }

    _fitIcon() {
        fitClone(this._icon, this._iconSource);
        this._layout();
    }

    _fitMenu() {
        fitClone(this._menu, this._menuSource);
        this._placeMenu();
    }

    _layout() {
        this._icon.y = Math.round((this.actor.height - this._icon.height) / 2);
        if (this._menu)
            this._placeMenu();
    }

    _placeMenu() {
        const place = this._menuPlace;
        const width = this._menu.width;
        const fromRight = !place || place.right <= place.left;

        this._menu.x = fromRight ? Math.round(this.actor.width - width - (place ? place.right : 0)) : place.left;
        this._menu.y = Math.round((this.actor.height - this._menu.height) / 2);
    }
}

export class CompactToggles extends Signals.EventEmitter {
    constructor(menu, settings, order) {
        super();
        this._settings = settings;
        this._userExpanded = settings.get_boolean('compact-expanded');
        this._order = order;
        this._box = menu.box;
        this._grid = menu._grid;
        this._active = false;
        this._fullHeight = 0;
        this._excluded = null;
        this._boxHeight = new HeightAnimator(this._box, MORPH_DURATION, MORPH_MODE);
        this._hiddenItems = [];
        this._watched = [];
        this._pairs = [];
        this._ghosts = new Map();
        this._fades = new Set();
        this._pendingFades = new Set();
        this._timers = new TimeoutTracker();
        this._refreshId = 0;
        this._drag = new ReorderDrag(
            () => this._pairs.map(pair => pair.proxy),
            (dragged, target) => this._moveProxy(dragged, target),
            () => this._commitOrder());

        this._circles = new St.Widget({
            style_class: 'sanket-compact-grid',
            x_expand: true,
            layout_manager: new Clutter.GridLayout({column_homogeneous: true}),
        });
        this._circles.connectObject('style-changed', () => this._syncSpacing(), this);
        this._actor = createBox(true, 'sanket-compact-box', {x_expand: true, visible: false});
        this._actor.add_child(this._circles);
        this._circlesHeight = new HeightAnimator(this._actor, MORPH_DURATION, MORPH_MODE);
        this._region = childContaining(this._box, this._grid);
        this._regionHeight = new HeightAnimator(this._region, MORPH_DURATION, MORPH_MODE);
        this._box.insert_child_above(this._actor, this._region);

        this._expandIcon = new St.Icon({icon_name: 'pan-down-symbolic'});
        centerPivot(this._expandIcon);
        this._expandButton = new St.Button({
            style_class: 'icon-button sanket-expand-button',
            can_focus: true,
            child: this._expandIcon,
        });
        this._expandButton.connectObject('clicked', () => this._toggleDemand(), this);
        const row = this._grid.get_children().find(child =>
            Boolean(child.has_style_class_name) && child.has_style_class_name('quick-settings-system-item')).child;
        row.insert_child_below(this._expandButton, row.get_children().find(child =>
            Boolean(child.has_style_class_name) && child.has_style_class_name('icon-button')));

        this._layer = new St.Widget({
            width: 0,
            height: 0,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
        });
        menu.actor.insert_child_below(this._layer, menu._overlay);
        this._layer.connectObject('notify::mapped', () => {
            if (!this._layer.mapped) {
                this._drag.cancel();
                this._settle();
            }
        }, this);
        this._order.connectObject(
            'changed', () => this._refresh(),
            'editing-changed', (_order, editing, cue) => this._drag.setEnabled(editing, cue),
            this);
        this._settings.connectObject(
            'changed::compact-show-volume', () => this._refresh(),
            'changed::compact-show-brightness', () => this._refresh(),
            'changed::compact-layout', () => this._onRowsChanged(),
            'changed::compact-mode', () => {
                this._syncDemand(false);
                this._refresh();
            },
            this);
        this._syncDemand(false);
    }

    get userExpanded() {
        return this._userExpanded;
    }

    get active() {
        return this._active;
    }

    get fullHeight() {
        return this._active ? this._fullHeight : this.contentHeight;
    }

    get resizing() {
        return [this._region, this._actor];
    }

    get regionOffset() {
        return [[this._region, this._regionHeight], [this._actor, this._circlesHeight]]
            .filter(([, animator]) => animator.running)
            .reduce((offset, [actor, animator]) => offset + actor.natural_height - animator.target, 0);
    }

    get contentHeight() {
        return this._currentContentHeight() - this.regionOffset;
    }

    _currentContentHeight() {
        const height = this._boxHeight.naturalHeight();
        if (!this._excluded || !this._excluded.visible)
            return height;

        const width = this._box.get_theme_node().adjust_for_width(this._box.allocation.get_width());
        const [, excluded] = this._excluded.get_preferred_height(width);
        return height - excluded - this._box.layout_manager.spacing;
    }

    setExcluded(actor) {
        this._excluded = actor;
    }

    setActive(active, animate) {
        if (this._active !== active) {
            const merged = Boolean(this._excluded);
            const fromHeight = merged
                ? this._region.allocation.get_height() + this._circlesExtent()
                : this._box.allocation.get_height();
            if (active) {
                this._fullHeight = this.contentHeight;
                this._show(animate);
            } else {
                this._hide(animate);
            }

            if (animate)
                this._animate(merged ? fromHeight - this._circlesExtent() : fromHeight, merged);
        }

        if (!animate)
            this._settle();
    }

    destroy() {
        this._timers.destroy();
        if (this._active)
            this._hide(false);
        this._settle();
        this._drag.destroy();
        this._order.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._layer.disconnectObject(this);
        this._layer.destroy();
        this._actor.destroy();
        this._expandButton.destroy();

        this._layer = null;
        this._drag = null;
        this._order = null;
        this._timers = null;
        this._watched = null;
        this._fades = null;
        this._pendingFades = null;
        this._ghosts = null;
        this._pairs = null;
        this._hiddenItems = null;
        this._actor = null;
        this._expandButton = null;
        this._expandIcon = null;
        this._boxHeight = null;
        this._regionHeight = null;
        this._circlesHeight = null;
        this._region = null;
        this._circles = null;
        this._grid = null;
        this._box = null;
        this._excluded = null;
        this._settings = null;
    }

    _toggleDemand() {
        this._userExpanded = !this._userExpanded;
        this._settings.set_boolean('compact-expanded', this._userExpanded);
        this._syncDemand(true);
        this.emit('demand-changed');
    }

    _syncDemand(animate) {
        const angle = this._userExpanded ? 180 : 0;
        this._expandButton.visible = this._settings.get_string('compact-mode') === 'demand';
        this._expandButton.checked = this._userExpanded;
        this._expandButton.accessible_name = this._userExpanded ? _('Collapse Settings') : _('Expand Settings');
        if (animate)
            rotateTo(this._expandIcon, angle, MORPH_DURATION, MORPH_MODE);
        else
            stopRotation(this._expandIcon, angle);
    }

    _show(animate) {
        this._grid.min_width = this._grid.get_preferred_width(-1)[1];

        for (const item of this._grid.get_children()) {
            if (!item.has_style_class_name || !item.visible ||
                item.has_style_class_name('quick-settings-system-item') ||
                this._keepsSlider(item))
                continue;

            const room = this._settings.get_string('compact-layout') === 'double' || this._pairs.length < COMPACT_COLUMNS;
            const icon = isToggle(item) && room ? findChild(item, isIcon) : null;
            if (icon) {
                const pair = this._createPair(item, icon);
                this._circles.add_child(pair.proxy);
                if (animate) {
                    pair.proxy.opacity = 0;
                    this._ghostFor(pair, item, icon, pair.proxy, pair.proxyIcon);
                }
            } else if (animate) {
                this._fadeAway(item);
            }

            item.hide();
            this._hiddenItems.push(item);
        }

        this._placeCircles();

        const refresh = () => this._queueRefresh();
        this._watched = this._grid.get_children();
        this._watched.forEach(item => item.connectObject('notify::visible', refresh, this));
        this._grid.connectObject(CHILD_ADDED, refresh, CHILD_REMOVED, refresh, this);

        this._actor.show();
        this._active = true;
    }

    _hide(animate) {
        this._drag.cancel();
        this._clearFades();
        if (animate) {
            this._pairs
                .filter(pair => isActorAlive(pair.proxy) && isActorAlive(pair.item))
                .forEach(pair => this._ghostFor(pair, pair.proxy, pair.proxyIcon, pair.item, pair.icon));
        }

        this._timers.remove(this._refreshId);
        this._refreshId = 0;
        this._grid.disconnectObject(this);
        this._watched.filter(isActorAlive).forEach(item => item.disconnectObject(this));
        this._pairs.map(pair => pair.icon).filter(isActorAlive).forEach(icon => icon.disconnectObject(this));

        this._actor.hide();
        this._circles.destroy_all_children();

        this._hiddenItems.filter(isActorAlive).forEach(item => {
            item.show();
            if (animate) {
                item.remove_transition('opacity');
                item.opacity = 0;
                if (!this._ghosts.has(item))
                    fadeIn(item);
            }
        });

        this._grid.min_width_set = false;
        this._pairs = [];
        this._watched = [];
        this._hiddenItems = [];
        this._active = false;
    }

    _circlesExtent() {
        if (!this._actor.visible)
            return 0;

        const [, height] = this._actor.get_preferred_height(this._box.allocation.get_width());
        return height + this._box.layout_manager.spacing;
    }

    _animate(fromHeight, merged) {
        if (merged)
            this._regionHeight.animate(fromHeight);
        else
            this._boxHeight.animate(fromHeight);
        if (this._ghosts.size === 0 && this._pendingFades.size === 0)
            return;

        global.stage.disconnectObject(this);
        global.stage.connectObject('after-paint', () => {
            const actors = [...this._pendingFades, ...[...this._ghosts.values()].map(ghost => ghost.actor)];
            if (actors.some(actor => !actor.has_allocation()))
                return;

            global.stage.disconnectObject(this);
            this._startFades();
            this._morph();
        }, this);
    }

    _ghostFor(pair, fromShell, fromIcon, toShell, toIcon) {
        let ghost = this._ghosts.get(pair.item);
        if (!ghost) {
            ghost = new MorphGhost(this._layer, pair.item, pair.icon, shapeOf(fromShell, fromIcon, this._layer));
            this._ghosts.set(pair.item, ghost);
        }
        ghost.retarget(toShell, toIcon);
    }

    _morph() {
        this._ghosts.forEach(ghost => {
            const {shell, icon} = ghost.target;
            if (isActorAlive(shell) && isActorAlive(icon))
                ghost.morphTo(shapeOf(shell, icon, this._layer), () => this._land(ghost));
            else
                this._dropGhost(ghost);
        });
    }

    _keepsSlider(item) {
        if (!item.has_style_class_name('quick-slider'))
            return false;

        const key = SLIDER_KEYS[item.constructor.name];
        return !key || this._settings.get_boolean(key);
    }

    _queueRefresh() {
        if (this._refreshId)
            return;

        this._refreshId = this._timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._refreshId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refresh() {
        if (!this._active)
            return;

        this._hide(false);
        this._fullHeight = this.contentHeight;
        this._show(false);
        this._settle();
    }

    _fadeAway(item) {
        const [x, y] = offsetIn(item, this._layer);
        const box = item.allocation;
        const clone = new Clutter.Clone({
            source: item,
            x,
            y,
            width: box.get_width(),
            height: box.get_height(),
        });
        this._layer.add_child(clone);
        this._fades.add(clone);
        this._pendingFades.add(clone);
    }

    _startFades() {
        this._pendingFades.forEach(clone => easeTo(clone, {opacity: 0}, () => {
            this._fades.delete(clone);
            clone.destroy();
        }, FADE_AWAY_DURATION));
        this._pendingFades.clear();
    }

    _clearFades() {
        this._fades.forEach(clone => clone.destroy());
        this._fades.clear();
        this._pendingFades.clear();
    }

    _land(ghost) {
        stopFade(ghost.target.shell);
        this._dropGhost(ghost);
    }

    _dropGhost(ghost) {
        this._ghosts.delete(ghost.item);
        ghost.destroy();
    }

    _settle() {
        global.stage.disconnectObject(this);
        this._boxHeight.stop();
        this._regionHeight.stop();
        this._circlesHeight.stop();
        this._ghosts.forEach(ghost => ghost.destroy());
        this._ghosts.clear();
        this._clearFades();
        this._pairs.forEach(pair => stopFade(pair.proxy));
        this._grid.get_children().forEach(item => stopFade(item));
    }

    _createPair(item, icon) {
        const proxyIcon = new St.Icon({style_class: 'quick-toggle-icon', icon_size: ICON_SIZE});
        const proxy = new St.Button({
            style_class: 'button quick-toggle sanket-compact-toggle',
            can_focus: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            child: proxyIcon,
        });

        const sync = () => {
            proxy.checked = item.checked;
            proxy.reactive = item.reactive;
            proxyIcon.gicon = icon.gicon;
        };

        item.connectObject('notify::checked', sync, 'notify::reactive', sync, this);
        icon.connectObject('notify::gicon', sync, this);
        proxy.connectObject('clicked', () => this._activate(item), this);
        this._drag.watch(proxy);

        sync();
        const pair = {item, icon, proxy, proxyIcon};
        this._pairs.push(pair);
        return pair;
    }

    _syncSpacing() {
        const spacing = this._circles.get_theme_node().get_length('spacing');
        this._circles.layout_manager.column_spacing = spacing;
        this._circles.layout_manager.row_spacing = spacing;
    }

    _placeCircles() {
        const layout = this._circles.layout_manager;
        this._circles.get_children().forEach((proxy, index) => {
            const meta = layout.get_child_meta(this._circles, proxy);
            meta.left_attach = index % COMPACT_COLUMNS;
            meta.top_attach = Math.floor(index / COMPACT_COLUMNS);
        });
    }

    _onRowsChanged() {
        if (!this._active)
            return;

        const fromHeight = this._actor.allocation.get_height();
        this._refresh();
        if (this._actor.mapped)
            this._circlesHeight.animate(fromHeight);
    }

    _moveProxy(dragged, target) {
        slideReorder(this._circles, () => {
            this._circles.set_child_at_index(dragged, this._circles.get_children().indexOf(target));
            this._placeCircles();
        }, dragged);
    }

    _commitOrder() {
        this._order.commit(this._circles.get_children().map(proxy => this._pairs.find(pair => pair.proxy === proxy).item));
    }

    _activate(item) {
        if (!isActorAlive(item))
            return;

        if (item.toggle_mode)
            item.checked = !item.checked;
        item.emit('clicked', 1);
    }
}