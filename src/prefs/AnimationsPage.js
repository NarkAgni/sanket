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


import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    accentColor, addGroup, addGroupReset, addSliderRow, easeOutQuart, fillRect, fmt, paintBackdrop,
    roundedRect, watchAccent,
} from './PrefsWidgets.js';


const PREVIEW_HEIGHT = 150;
const MORPH_DURATION = 480;
const HOLD_DURATION = 900;
const PILL_HEIGHT = 44;

function lerp(from, to, progress) {
    return from + (to - from) * progress;
}

class MorphDemo {
    constructor(settings) {
        this._settings = settings;
        this._start = 0;
        this._elapsed = 0;

        this.widget = new Gtk.DrawingArea({content_height: PREVIEW_HEIGHT, hexpand: true});
        this.widget.set_draw_func((_area, cr, width, height) => this._draw(cr, width, height));
        this.widget.add_tick_callback((widget, clock) => {
            const now = clock.get_frame_time() / 1000;
            if (!this._start)
                this._start = now;
            this._elapsed = now - this._start;
            widget.queue_draw();
            return GLib.SOURCE_CONTINUE;
        });
        watchAccent(this.widget);
    }

    _progress() {
        const morph = MORPH_DURATION / this._settings.get_double('animation-speed');
        const time = this._elapsed % (2 * (HOLD_DURATION + morph));

        if (time < HOLD_DURATION)
            return 0;
        if (time < HOLD_DURATION + morph)
            return easeOutQuart((time - HOLD_DURATION) / morph);
        if (time < 2 * HOLD_DURATION + morph)
            return 1;
        return 1 - easeOutQuart((time - 2 * HOLD_DURATION - morph) / morph);
    }

    _draw(cr, width, height) {
        roundedRect(cr, 0, 0, width, height, 14);
        cr.clip();
        paintBackdrop(cr, width, height);

        const progress = this._progress();
        const pillWidth = Math.min(220, width - 60);
        const shapeWidth = lerp(pillWidth, PILL_HEIGHT, progress);
        const x = (width - pillWidth) / 2;
        const y = (height - PILL_HEIGHT) / 2;
        const {red, green, blue} = accentColor();

        cr.save();
        roundedRect(cr, x, y, shapeWidth, PILL_HEIGHT, PILL_HEIGHT / 2);
        cr.setSourceRGBA(red, green, blue, 1);
        cr.fillPreserve();
        cr.clip();

        const iconX = lerp(x + 22, x + PILL_HEIGHT / 2, progress);
        cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.arc(iconX, y + PILL_HEIGHT / 2, 7, 0, 2 * Math.PI);
        cr.fill();

        const textAlpha = Math.max(0, 1 - progress * 2.2);
        fillRect(cr, iconX + 18, y + 13, pillWidth * 0.35, 7, 3.5, 0.95 * textAlpha);
        fillRect(cr, iconX + 18, y + 25, pillWidth * 0.22, 6, 3, 0.6 * textAlpha);
        fillRect(cr, x + pillWidth - 40, y, 40, PILL_HEIGHT, 0, 0.18 * textAlpha);
        cr.restore();
    }
}

export function buildAnimationsPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Animations'),
        icon_name: 'emblem-system-symbolic',
    });

    const demo = new MorphDemo(settings);
    const heroGroup = addGroup(page, _('Motion'), _('Every Sanket animation follows this speed'));
    heroGroup.add(demo.widget);

    const speedGroup = addGroup(page, _('Speed'));
    addGroupReset(speedGroup, settings, ['animation-speed']);
    addSliderRow(speedGroup, settings, 'animation-speed', _('Animation Speed'),
        _('Higher is quicker, lower is slower and calmer'), {lower: 0.25, upper: 3, step: 0.25}, fmt.times);

    window.add(page);
}