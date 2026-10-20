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
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

import {drawWeather} from '../lib/WeatherArt.js';


const STILL_TIME = 0.1;
const FRAME_INTERVAL = GLib.USEC_PER_SEC / 30;

export const WeatherScene = GObject.registerClass(
class WeatherScene extends St.DrawingArea {
    _init() {
        super._init({style_class: 'sanket-weather-scene', y_align: Clutter.ActorAlign.CENTER});
        this._kind = 'clear';
        this._night = false;
        this._animated = true;
        this._time = STILL_TIME;
        this._origin = 0;
        this._lastFrame = 0;

        this._timeline = new Clutter.Timeline({actor: this, duration: 1000, repeat_count: -1});
        this._timeline.connect('new-frame', () => this._onFrame());
        St.Settings.get().connectObject('notify::enable-animations', () => this._sync(), this);
        this.connect('destroy', () => {
            St.Settings.get().disconnectObject(this);
            this._timeline.stop();
            this._timeline = null;
        });
    }

    setWeather(kind, night) {
        this._kind = kind;
        this._night = night;
        this.queue_repaint();
    }

    setAnimated(animated) {
        this._animated = animated;
        this._sync();
    }

    vfunc_map() {
        super.vfunc_map();
        this._sync();
    }

    vfunc_unmap() {
        this._timeline.stop();
        super.vfunc_unmap();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        drawWeather(cr, width, height, this._kind, this._night, this._time);
        cr.$dispose();
    }

    _onFrame() {
        const now = GLib.get_monotonic_time();
        if (now - this._lastFrame < FRAME_INTERVAL)
            return;

        this._lastFrame = now;
        this._time = (now - this._origin) / GLib.USEC_PER_SEC;
        this.queue_repaint();
    }

    _sync() {
        const running = this._animated && this.mapped && St.Settings.get().enable_animations;
        if (running && !this._timeline.is_playing()) {
            this._origin = GLib.get_monotonic_time() - this._time * GLib.USEC_PER_SEC;
            this._timeline.start();
        } else if (!running) {
            this._timeline.stop();
            if (!this._animated)
                this._time = STILL_TIME;
            this.queue_repaint();
        }
    }
});