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
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import {easeTo} from '../ui/Animations.js';


const SHIFT = 28;
const ROW_DELAY = 18;
const DURATION = 320;
const MODE = Clutter.AnimationMode.EASE_OUT_QUART;

function monthOf(date) {
    return date.getFullYear() * 12 + date.getMonth();
}

export class CalendarMotion {
    constructor(calendar) {
        this._calendar = calendar;
        this._month = monthOf(calendar._selectedDate);
        this._injections = new InjectionManager();

        const motion = this;
        this._injections.overrideMethod(calendar, '_rebuildCalendar', original =>
            function (...args) {
                original.call(this, ...args);
                motion._animate();
            });
    }

    destroy() {
        this._injections.clear();
        this._injections = null;
        this._calendar = null;
    }

    _animate() {
        const calendar = this._calendar;
        const month = monthOf(calendar._selectedDate);
        const direction = Math.sign(month - this._month);
        this._month = month;

        if (direction === 0 || !calendar.mapped)
            return;

        const rtl = calendar.get_text_direction() === Clutter.TextDirection.RTL ? -1 : 1;
        calendar.get_children().slice(calendar._firstDayIndex).forEach((day, index) => {
            day.translation_x = SHIFT * direction * rtl;
            day.opacity = 0;
            easeTo(day, {translation_x: 0, opacity: 255}, null, DURATION, MODE, Math.floor(index / 7) * ROW_DELAY);
        });

        calendar._monthLabel.opacity = 0;
        easeTo(calendar._monthLabel, {opacity: 255}, null, DURATION, MODE);
    }
}