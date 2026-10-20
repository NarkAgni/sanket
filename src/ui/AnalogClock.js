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
import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';


const TICKS = 12;

export const AnalogClock = GObject.registerClass(
class AnalogClock extends St.DrawingArea {
    _init(small) {
        super._init({
            style_class: small ? 'sanket-analog-clock sanket-analog-clock-small' : 'sanket-analog-clock',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._hour = 0;
        this._minute = 0;
    }

    setTime(hour, minute) {
        this._hour = hour;
        this._minute = minute;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        const {red, green, blue, alpha} = this.get_theme_node().get_foreground_color();
        const radius = Math.min(width, height) / 2;
        const paint = strength => cr.setSourceRGBA(red / 255, green / 255, blue / 255, alpha / 255 * strength);

        cr.translate(width / 2, height / 2);
        cr.setLineCap(Cairo.LineCap.ROUND);

        const ring = Math.max(radius * 0.06, 1);
        paint(0.3);
        cr.setLineWidth(ring);
        cr.arc(0, 0, radius - ring, 0, 2 * Math.PI);
        cr.stroke();

        paint(0.6);
        for (let tick = 0; tick < TICKS; tick++) {
            const angle = tick * 2 * Math.PI / TICKS;
            cr.arc(Math.sin(angle) * radius * 0.72, -Math.cos(angle) * radius * 0.72, radius * 0.05, 0, 2 * Math.PI);
            cr.fill();
        }

        paint(1);
        this._hand(cr, ((this._hour % 12) + this._minute / 60) / 12, radius * 0.42, radius * 0.11);
        this._hand(cr, this._minute / 60, radius * 0.62, radius * 0.08);
        cr.arc(0, 0, radius * 0.1, 0, 2 * Math.PI);
        cr.fill();

        cr.$dispose();
    }

    _hand(cr, turn, length, width) {
        const angle = turn * 2 * Math.PI;
        cr.setLineWidth(width);
        cr.moveTo(0, 0);
        cr.lineTo(Math.sin(angle) * length, -Math.cos(angle) * length);
        cr.stroke();
    }
});