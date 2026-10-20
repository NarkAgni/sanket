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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isActorAlive} from '../lib/Utils.js';
import {easeTo, stopFade} from './Animations.js';


const LIFT_SCALE = 1.06;
const LIFT_DURATION = 160;
const DROP_DURATION = 220;
const SLIDE_DURATION = 220;
const SLIDE_MODE = Clutter.AnimationMode.EASE_OUT_CUBIC;
const MOVE_INTERVAL = 60 * 1000;

function containsPoint(actor, x, y) {
    const [inside, localX, localY] = actor.get_parent().transform_stage_point(x, y);
    const box = actor.get_allocation_box();
    return inside && localX >= box.x1 && localX < box.x2 && localY >= box.y1 && localY < box.y2;
}

export function slideReorder(container, reorder, skip) {
    container.get_allocation_box();
    const children = container.get_children();
    const before = children.map(child => {
        const box = child.get_allocation_box();
        return [box.x1 + child.translation_x, box.y1 + child.translation_y];
    });

    reorder();
    container.get_allocation_box();

    children.forEach((child, index) => {
        const box = child.get_allocation_box();
        const dx = before[index][0] - box.x1;
        const dy = before[index][1] - box.y1;
        if (child === skip || (Math.abs(dx) < 1 && Math.abs(dy) < 1))
            return;

        child.remove_transition('translation-x');
        child.remove_transition('translation-y');
        child.set_translation(dx, dy, 0);
        easeTo(child, {translation_x: 0, translation_y: 0}, null, SLIDE_DURATION, SLIDE_MODE);
    });
}

export class ReorderDrag {
    constructor(items, onMove, onDrop) {
        this._items = items;
        this._onMove = onMove;
        this._onDrop = onDrop;
        this._watched = new Set();
        this._styles = new Map();
        this._landing = new Map();
        this._enabled = false;
        this._cue = '';
        this._press = null;
        this._drag = null;
    }

    setEnabled(enabled, cue) {
        this._enabled = enabled;
        this._cue = cue;
        this._watched.forEach(item => this._syncCue(item));
        if (!enabled)
            this.cancel();
    }

    watch(item) {
        if (this._watched.has(item))
            return;

        item.connectObject(
            'captured-event', (_item, event) => this._onEvent(item, event),
            'destroy', () => {
                this._watched.delete(item);
                this._styles.delete(item);
            },
            this);
        this._watched.add(item);
        this._syncCue(item);
    }

    unwatch(item) {
        if (!this._watched.delete(item))
            return;

        item.disconnectObject(this);
        this._restoreStyle(item);
    }

    cancel() {
        this._press = null;
        if (this._drag)
            this._finish(false);
    }

    destroy() {
        this.cancel();
        [...this._landing.keys()].forEach(clone => this._land(clone));
        [...this._watched].filter(isActorAlive).forEach(item => this.unwatch(item));

        this._watched = null;
        this._styles = null;
        this._landing = null;
        this._items = null;
        this._onMove = null;
        this._onDrop = null;
    }

    _syncCue(item) {
        if (!this._enabled) {
            this._restoreStyle(item);
            return;
        }

        if (!this._styles.has(item))
            this._styles.set(item, item.style);
        item.style = [this._styles.get(item), this._cue].filter(Boolean).join(' ');
    }

    _restoreStyle(item) {
        if (!this._styles.has(item))
            return;

        item.style = this._styles.get(item);
        this._styles.delete(item);
    }

    _onEvent(item, event) {
        if (!this._enabled)
            return Clutter.EVENT_PROPAGATE;

        const type = event.type();
        if (type === Clutter.EventType.BUTTON_PRESS) {
            this._press = event.get_button() === Clutter.BUTTON_PRIMARY ? {item, coords: event.get_coords()} : null;
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE) {
            this._press = null;
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.MOTION && this._press)
            return this._onPressMotion(event);

        return Clutter.EVENT_PROPAGATE;
    }

    _onPressMotion(event) {
        const press = this._press;
        const [x, y] = event.get_coords();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const threshold = St.Settings.get().drag_threshold * scale;
        if (Math.abs(x - press.coords[0]) > threshold || Math.abs(y - press.coords[1]) > threshold)
            this._begin(press.item, x, y);
        return Clutter.EVENT_STOP;
    }

    _begin(item, x, y) {
        this._press = null;

        const [itemX, itemY] = item.get_transformed_position();
        const [width, height] = item.get_transformed_size();
        const clone = new Clutter.Clone({source: item, reactive: true, x: itemX, y: itemY, width, height});
        clone.set_pivot_point(0.5, 0.5);
        Main.uiGroup.add_child(clone);

        item.remove_transition('opacity');
        item.opacity = 0;
        easeTo(clone, {scale_x: LIFT_SCALE, scale_y: LIFT_SCALE}, null, LIFT_DURATION);

        this._drag = {
            item,
            clone,
            grab: Main.pushModal(clone),
            offsetX: x - itemX,
            offsetY: y - itemY,
            target: null,
            movedAt: 0,
        };
        clone.connectObject(
            'motion-event', (_clone, event) => this._onDragMotion(event),
            'button-release-event', () => this._finish(true),
            this);
    }

    _onDragMotion(event) {
        const drag = this._drag;
        const [x, y] = event.get_coords();
        drag.clone.set_position(x - drag.offsetX, y - drag.offsetY);

        const target = this._items().find(other => other !== drag.item && containsPoint(other, x, y)) || null;
        const now = GLib.get_monotonic_time();
        if (!target) {
            drag.target = null;
        } else if (target !== drag.target && now - drag.movedAt >= MOVE_INTERVAL && isActorAlive(drag.item)) {
            this._onMove(drag.item, target);
            drag.target = target;
            drag.movedAt = now;
        }
        return Clutter.EVENT_STOP;
    }

    _finish(animate) {
        const {item, clone, grab} = this._drag;
        this._drag = null;
        clone.disconnectObject(this);
        Main.popModal(grab);

        if (animate && isActorAlive(item) && item.mapped) {
            const [x, y] = item.get_transformed_position();
            this._landing.set(clone, item);
            easeTo(clone, {x, y, scale_x: 1, scale_y: 1}, () => this._land(clone), DROP_DURATION);
        } else {
            clone.destroy();
            stopFade(item);
        }

        if (isActorAlive(item))
            this._onDrop();
    }

    _land(clone) {
        if (!this._landing || !this._landing.has(clone))
            return;

        const item = this._landing.get(clone);
        this._landing.delete(clone);
        clone.destroy();
        stopFade(item);
    }
}