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

import {TimeoutTracker} from '../lib/TimeoutTracker.js';
import {CHILD_ADDED, CHILD_REMOVED, createBox, isActorAlive} from '../lib/Utils.js';
import {HeightAnimator, easeTo, fadeIn, stopFade} from './Animations.js';


const COMPACT_COLUMNS = 6;
const ICON_SIZE = 16;
const TEXT_CLASSES = ['quick-toggle-title', 'quick-toggle-subtitle'];
const MORPH_DURATION = 480;
const MORPH_MODE = Clutter.AnimationMode.EASE_OUT_QUART;
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
        actor.has_style_class_name('quick-toggle-menu-button');
}

const SLIDER_KEYS = {
    OutputStreamSlider: 'compact-show-volume',
    InputStreamSlider: 'compact-show-volume',
    BrightnessItem: 'compact-show-brightness',
};

function isToggle(item) {
    return item.has_style_class_name('quick-toggle') || item.has_style_class_name('quick-toggle-has-menu');
}

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

function fitClone(clone, source) {
    const box = source.get_allocation_box();
    clone.set_size(box.get_width(), box.get_height());
}

class MorphGhost {
    constructor(layer, item, sourceIcon, shape) {
        this.item = item;
        this.target = null;

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
        easeTo(this.actor, {
            x: shape.x,
            y: shape.y,
            width: shape.width,
            height: shape.height,
        }, onDone, MORPH_DURATION, MORPH_MODE);
    }

    destroy() {
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

export class CompactToggles {
    constructor(menu, settings) {
        this._settings = settings;
        this._box = menu.box;
        this._grid = menu._grid;
        this._active = false;
        this._fullHeight = 0;
        this._boxHeight = new HeightAnimator(this._box, MORPH_DURATION, MORPH_MODE);
        this._hiddenItems = [];
        this._watched = [];
        this._pairs = [];
        this._ghosts = new Map();
        this._fades = new Set();
        this._timers = new TimeoutTracker();
        this._refreshId = 0;

        this._rows = createBox(true, 'sanket-compact-grid', {x_expand: true});
        this._actor = createBox(true, 'sanket-compact-box', {x_expand: true, visible: false});
        this._actor.add_child(this._rows);
        this._box.insert_child_above(this._actor, this._grid);

        this._layer = new St.Widget({
            width: 0,
            height: 0,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
        });
        menu._overlay.add_child(this._layer);
        this._layer.connectObject('notify::mapped', () => {
            if (!this._layer.mapped)
                this._settle();
        }, this);
        this._settings.connectObject(
            'changed::compact-show-volume', () => this._refresh(),
            'changed::compact-show-brightness', () => this._refresh(),
            this);
    }

    get active() {
        return this._active;
    }

    get fullHeight() {
        return this._active ? this._fullHeight : this._boxHeight.naturalHeight();
    }

    setActive(active, animate) {
        if (this._active !== active) {
            const fromHeight = this._box.get_allocation_box().get_height();
            if (active) {
                this._fullHeight = this._boxHeight.naturalHeight();
                this._show(animate);
            } else {
                this._hide(animate);
            }

            if (animate)
                this._animate(fromHeight);
        }

        if (!animate)
            this._settle();
    }

    destroy() {
        this._timers.destroy();
        if (this._active)
            this._hide(false);
        this._settle();
        this._settings.disconnectObject(this);
        this._layer.disconnectObject(this);
        this._layer.destroy();
        this._actor.destroy();

        this._layer = null;
        this._timers = null;
        this._watched = null;
        this._fades = null;
        this._ghosts = null;
        this._pairs = null;
        this._hiddenItems = null;
        this._actor = null;
        this._boxHeight = null;
        this._rows = null;
        this._grid = null;
        this._box = null;
        this._settings = null;
    }

    _show(animate) {
        const row = createBox(false, 'sanket-compact-row', {x_expand: true});
        row.layout_manager.homogeneous = true;
        this._grid.width = this._grid.width;

        for (const item of this._grid.get_children()) {
            if (!item.has_style_class_name || !item.visible ||
                item.has_style_class_name('quick-settings-system-item') ||
                this._keepsSlider(item))
                continue;

            const icon = isToggle(item) ? findChild(item, isIcon) : null;
            if (icon && this._pairs.length < COMPACT_COLUMNS) {
                const pair = this._createPair(item, icon);
                row.add_child(pair.proxy);
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

        if (this._pairs.length > 0)
            this._rows.add_child(row);
        else
            row.destroy();

        const refresh = () => this._queueRefresh();
        this._watched = this._grid.get_children();
        this._watched.forEach(item => item.connectObject('notify::visible', refresh, this));
        this._grid.connectObject(CHILD_ADDED, refresh, CHILD_REMOVED, refresh, this);

        this._actor.show();
        this._active = true;
    }

    _hide(animate) {
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
        this._rows.destroy_all_children();

        this._hiddenItems.filter(isActorAlive).forEach(item => {
            item.show();
            if (animate) {
                item.remove_transition('opacity');
                item.opacity = 0;
                if (!this._ghosts.has(item))
                    fadeIn(item);
            }
        });

        this._grid.width = -1;
        this._pairs = [];
        this._watched = [];
        this._hiddenItems = [];
        this._active = false;
    }

    _animate(fromHeight) {
        this._boxHeight.animate(fromHeight);
        if (this._ghosts.size === 0)
            return;

        global.stage.disconnectObject(this);
        global.stage.connectObject('after-paint', () => {
            global.stage.disconnectObject(this);
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
        this._fullHeight = this._boxHeight.naturalHeight();
        this._show(false);
        this._settle();
    }

    _fadeAway(item) {
        const [x, y] = offsetIn(item, this._layer);
        const box = item.get_allocation_box();
        const clone = new Clutter.Clone({
            source: item,
            x,
            y,
            width: box.get_width(),
            height: box.get_height(),
        });
        this._layer.add_child(clone);
        this._fades.add(clone);
        easeTo(clone, {opacity: 0}, () => {
            this._fades.delete(clone);
            clone.destroy();
        }, FADE_AWAY_DURATION);
    }

    _clearFades() {
        this._fades.forEach(clone => clone.destroy());
        this._fades.clear();
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

        sync();
        const pair = {item, icon, proxy, proxyIcon};
        this._pairs.push(pair);
        return pair;
    }

    _activate(item) {
        if (!isActorAlive(item))
            return;

        if (item.toggle_mode)
            item.checked = !item.checked;
        item.emit('clicked', 1);
    }
}