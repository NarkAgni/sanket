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
import {easeTo, scaled, stopFade} from './Animations.js';


const HIDE_DELAY = 800;
const REVEAL_DURATION = 160;
const HIDE_DURATION = 420;
const REVEAL_DISTANCE = 24;

function findVerticalBar(scrollView) {
    return scrollView.get_children().find(child =>
        child.constructor === St.ScrollBar &&
        (child.vertical || child.orientation === Clutter.Orientation.VERTICAL));
}

export class ScrollbarAutoHide {
    constructor(scrollView, mode) {
        this._scrollView = scrollView;
        this._scrollBar = findVerticalBar(scrollView);
        this._timers = new TimeoutTracker();
        this._hideId = 0;
        this._near = false;
        this._shown = false;
        this._mode = mode;

        this._scrollBar.connectObject(
            'scroll-start', () => this._setNear(true),
            'scroll-stop', () => this._setNear(false),
            this);
        this._scrollView.connectObject(
            'scroll-event', () => this._onScroll(),
            'motion-event', (_actor, event) => this._onMotion(event),
            'leave-event', (_actor, event) => this._onLeave(event),
            this);
        this.reset();
    }

    get adjustment() {
        return this._scrollBar.adjustment;
    }

    get barWidth() {
        return this._mode === 'never' ? 0 : this._scrollBar.get_preferred_width(-1)[1];
    }

    setOffset(offset) {
        this._scrollBar.translation_x = offset;
    }

    setMode(mode) {
        this._mode = mode;
        this.reset();
    }

    reset() {
        this._cancelHide();
        this._near = false;
        this._shown = this._mode === 'always';
        this._scrollBar.remove_transition('opacity');
        this._scrollBar.opacity = this._shown ? 255 : 0;
        this._scrollBar.reactive = this._mode !== 'never';
    }

    destroy() {
        this._timers.destroy();
        this._scrollBar.disconnectObject(this);
        this._scrollView.disconnectObject(this);
        stopFade(this._scrollBar);
        this._scrollBar.reactive = true;
        this._scrollBar.translation_x = 0;
        this._scrollBar = null;
        this._scrollView = null;
    }

    _onScroll() {
        this._reveal();
        return Clutter.EVENT_PROPAGATE;
    }

    _onMotion(event) {
        const [pointerX] = event.get_coords();
        const [barX] = this._scrollBar.get_transformed_position();
        const [barWidth] = this._scrollBar.get_transformed_size();
        const reach = REVEAL_DISTANCE * St.ThemeContext.get_for_stage(global.stage).scale_factor;

        this._setNear(pointerX >= barX - reach && pointerX <= barX + barWidth + reach);
        return Clutter.EVENT_PROPAGATE;
    }

    _onLeave(event) {
        const related = event.get_related();
        if (!related || !this._scrollView.contains(related))
            this._setNear(false);
        return Clutter.EVENT_PROPAGATE;
    }

    _setNear(near) {
        if (this._near === near)
            return;

        this._near = near;
        if (near)
            this._reveal();
        else
            this._queueHide();
    }

    _reveal() {
        if (this._mode !== 'auto')
            return;

        this._cancelHide();
        this._fade(true, REVEAL_DURATION);
        if (!this._near)
            this._queueHide();
    }

    _queueHide() {
        if (this._mode !== 'auto')
            return;

        this._cancelHide();
        this._hideId = this._timers.addTimeout(GLib.PRIORITY_DEFAULT, scaled(HIDE_DELAY), () => {
            this._hideId = 0;
            this._fade(false, HIDE_DURATION);
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelHide() {
        this._timers.remove(this._hideId);
        this._hideId = 0;
    }

    _fade(shown, duration) {
        if (this._shown === shown)
            return;

        this._shown = shown;
        easeTo(this._scrollBar, {opacity: shown ? 255 : 0}, null, duration);
    }
}