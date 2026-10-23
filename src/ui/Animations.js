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


import Clutter from 'gi://Clutter';

import {isActorAlive} from '../lib/Utils.js';


export const DURATION = 280;
export const FAST_DURATION = 180;
export const MODE = Clutter.AnimationMode.EASE_OUT_EXPO;
export const MORPH_DURATION = 480;
export const MORPH_MODE = Clutter.AnimationMode.EASE_OUT_QUART;

const targets = new WeakMap();
let speed = 1;

export function setAnimationSpeed(value) {
    speed = Math.max(value, 0.1);
}

export function scaled(duration) {
    return Math.round(duration / speed);
}

function transitionName(key) {
    return key.replace(/_/g, '-');
}

function remember(actor, props) {
    const current = targets.get(actor) || {};
    Object.entries(props).forEach(([key, value]) => {
        current[transitionName(key)] = value;
    });
    targets.set(actor, current);
}

function reaching(actor, key, value) {
    if (!actor.get_transition(transitionName(key)))
        return actor[key] === value;

    const current = targets.get(actor);
    return Boolean(current) && current[transitionName(key)] === value;
}

export function easeTo(actor, props, onComplete, duration = DURATION, mode = MODE, delay = 0) {
    if (!isActorAlive(actor))
        return;

    remember(actor, props);
    actor.ease({
        ...props,
        duration: scaled(duration),
        mode,
        delay: scaled(delay),
        onComplete,
    });
}

export function fadeIn(actor, duration = DURATION) {
    if (!isActorAlive(actor))
        return;

    easeTo(actor, {opacity: 255}, null, duration);
}

export function fadeTo(actor, shown, animate, duration = FAST_DURATION) {
    if (!isActorAlive(actor))
        return;

    const opacity = shown ? 255 : 0;
    if (!animate) {
        actor.remove_transition('opacity');
        actor.opacity = opacity;
    } else if (!reaching(actor, 'opacity', opacity)) {
        easeTo(actor, {opacity}, null, duration);
    }
}

export function rotateTo(actor, angle, duration = DURATION, mode = MODE) {
    if (isActorAlive(actor) && !reaching(actor, 'rotation_angle_z', angle))
        easeTo(actor, {rotation_angle_z: angle}, null, duration, mode);
}

export function centerPivot(actor) {
    if (isActorAlive(actor))
        actor.set_pivot_point(0.5, 0.5);
}

export function stopFade(actor) {
    if (!isActorAlive(actor))
        return;

    actor.remove_transition('opacity');
    actor.opacity = 255;
}

export function stopRotation(actor, angle) {
    if (!isActorAlive(actor))
        return;

    actor.remove_transition('rotation-angle-z');
    actor.rotation_angle_z = angle;
}

export function measureHeight(actor) {
    const width = actor.allocation.get_width() || actor.get_parent().allocation.get_width();
    if (!actor.layout_manager)
        return actor.get_preferred_height(width)[1];

    const node = actor.get_theme_node();
    const [, natural] = actor.layout_manager.get_preferred_height(actor, node.adjust_for_width(width));
    return node.adjust_preferred_height(0, natural)[1];
}

export class HeightAnimator {
    constructor(actor, duration = DURATION, mode = MODE) {
        this._actor = actor;
        this._duration = duration;
        this._mode = mode;
        this._target = 0;
    }

    get running() {
        return this._actor.natural_height_set;
    }

    get target() {
        return this._target;
    }

    naturalHeight() {
        return measureHeight(this._actor);
    }

    animate(from) {
        this._actor.remove_transition('height');
        this._actor.height = -1;
        const to = this.naturalHeight();
        this._target = to;
        if (Math.abs(from - to) < 1) {
            this.stop();
            return;
        }

        this._actor.height = from;
        this._actor.disconnectObject(this);
        this._actor.connectObject('notify::mapped', () => {
            if (!this._actor.mapped)
                this.stop();
        }, this);

        easeTo(this._actor, {height: to}, () => this.stop(), this._duration, this._mode);
    }

    stop() {
        this._actor.disconnectObject(this);
        this._actor.remove_transition('height');
        this._actor.height = -1;
    }
}