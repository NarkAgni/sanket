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

import {drawWeather} from '../lib/WeatherArt.js';
import {onSettingChanged} from './SettingsSignals.js';
import {
    accentColor, addArt, addChoiceCards, addGroup, addGroupReset, addSwitchRow, fillRect, paintBackdrop,
    roundedRect, watchAccent,
} from './PrefsWidgets.js';


const PREVIEW_HEIGHT = 300;
const COLUMN = 120;
const GAP = 6;
const PADDING = 8;
const PREVIEW_KEYS = ['calendar-layout', 'clock-style', 'show-events', 'show-date-header'];
const CALENDAR_KEYS = [...PREVIEW_KEYS, 'show-setup-hints', 'weather-animated'];
const STILL_TIME = 0.1;

const WEATHER_SAMPLES = () => [
    ['clear', false, _('Clear Sky')],
    ['clear', true, _('Clear Night')],
    ['partly', false, _('Partly Cloudy')],
    ['partly', true, _('Cloudy Night')],
    ['overcast', false, _('Cloudy')],
    ['rain', false, _('Rain')],
    ['snow', false, _('Snow')],
    ['storm', false, _('Thunderstorm')],
    ['fog', false, _('Fog')],
];

function paintClockFace(cr, x, y, radius) {
    cr.setSourceRGBA(1, 1, 1, 0.45);
    cr.setLineWidth(1);
    cr.arc(x, y, radius, 0, 2 * Math.PI);
    cr.stroke();
    cr.setSourceRGBA(1, 1, 1, 0.9);
    cr.setLineWidth(1.4);
    cr.moveTo(x, y);
    cr.lineTo(x, y - radius * 0.65);
    cr.moveTo(x, y);
    cr.lineTo(x + radius * 0.45, y + radius * 0.2);
    cr.stroke();
}

function dateSection() {
    return {
        height: 22,
        paint(cr, x, y, width) {
            fillRect(cr, x, y, width, 22, 7, 0.06);
            fillRect(cr, x + 8, y + 5, width * 0.35, 5, 2.5, 0.5);
            fillRect(cr, x + 8, y + 13, width * 0.55, 5, 2.5, 0.85);
        },
    };
}

function calendarSection() {
    return {
        height: 92,
        paint(cr, x, y, width) {
            const {red, green, blue} = accentColor();
            fillRect(cr, x, y, width, 92, 8, 0.06);
            fillRect(cr, x + width / 2 - 18, y + 8, 36, 5, 2.5, 0.8);

            const cell = (width - 12) / 7;
            for (let row = 0; row < 5; row++) {
                for (let column = 0; column < 7; column++) {
                    const cx = x + 6 + cell * (column + 0.5);
                    const cy = y + 26 + row * 13;
                    if (row === 2 && column === 1) {
                        cr.setSourceRGBA(red, green, blue, 1);
                        cr.arc(cx, cy, 5, 0, 2 * Math.PI);
                    } else {
                        cr.setSourceRGBA(1, 1, 1, row === 4 && column > 2 ? 0.25 : 0.7);
                        cr.arc(cx, cy, 1.6, 0, 2 * Math.PI);
                    }
                    cr.fill();
                }
            }
        },
    };
}

function eventsSection() {
    return {
        height: 44,
        paint(cr, x, y, width) {
            fillRect(cr, x, y, width, 44, 8, 0.06);
            [8, 20, 32].forEach(lineY => {
                fillRect(cr, x + 8, y + lineY, 14, 5, 2.5, 0.45);
                fillRect(cr, x + 28, y + lineY, width * 0.5, 5, 2.5, 0.8);
            });
        },
    };
}

function clocksSection(style) {
    const compact = style === 'compact';
    const rows = compact ? 5 : 3;
    const rowHeight = compact ? 12 : 20;
    const height = rows * rowHeight + 12;

    return {
        height,
        paint(cr, x, y, width) {
            fillRect(cr, x, y, width, height, 8, 0.06);
            for (let row = 0; row < rows; row++) {
                const rowY = y + 6 + row * rowHeight + rowHeight / 2;
                if (compact) {
                    paintClockFace(cr, x + 12, rowY, 4);
                    fillRect(cr, x + 22, rowY - 2.5, width * 0.4, 5, 2.5, 0.85);
                    fillRect(cr, x + width - 26, rowY - 2, 18, 4, 2, 0.4);
                } else {
                    paintClockFace(cr, x + 15, rowY, 7);
                    fillRect(cr, x + 28, rowY - 6, width * 0.4, 5, 2.5, 0.85);
                    fillRect(cr, x + 28, rowY + 2, 22, 4, 2, 0.4);
                }
            }
        },
    };
}

function weatherSection() {
    return {
        height: 28,
        paint(cr, x, y, width) {
            fillRect(cr, x, y, width, 28, 8, 0.06);
            cr.setSourceRGBA(0.98, 0.8, 0.3, 1);
            cr.arc(x + 14, y + 14, 6, 0, 2 * Math.PI);
            cr.fill();
            fillRect(cr, x + 26, y + 8, width * 0.4, 5, 2.5, 0.85);
            fillRect(cr, x + 26, y + 16, 22, 4, 2, 0.45);
        },
    };
}

export function paintPopover(cr, width, height, options) {
    const {layout, clockStyle, events, header} = options;
    const clocks = clocksSection(clockStyle);
    const weather = options.weather ? weatherSection() : null;
    const columns = (layout === 'wide'
        ? [[weather, clocks, events ? eventsSection() : null], [header ? dateSection() : null, calendarSection()]]
        : [[header ? dateSection() : null, calendarSection(), events ? eventsSection() : null, clocks, weather]])
        .map(column => column.filter(Boolean))
        .filter(column => column.length > 0);

    const heights = columns.map(column =>
        column.reduce((sum, section) => sum + section.height, 0) + GAP * (column.length - 1));
    const popoverWidth = columns.length * COLUMN + (columns.length - 1) * GAP + PADDING * 2;
    const popoverHeight = Math.max(...heights) + PADDING * 2;
    const scale = Math.min((width - 16) / popoverWidth, (height - 16) / popoverHeight, 1.6);

    cr.save();
    cr.translate((width - popoverWidth * scale) / 2, (height - popoverHeight * scale) / 2);
    cr.scale(scale, scale);
    roundedRect(cr, 0, 0, popoverWidth, popoverHeight, 14);
    cr.setSourceRGBA(0.12, 0.12, 0.14, 0.95);
    cr.fill();

    columns.forEach((column, index) => {
        const x = PADDING + index * (COLUMN + GAP);
        let y = PADDING;
        column.forEach(section => {
            section.paint(cr, x, y, COLUMN);
            y += section.height + GAP;
        });
    });
    cr.restore();
}

function weatherGallery(settings) {
    const gallery = new Gtk.FlowBox({
        selection_mode: Gtk.SelectionMode.NONE,
        min_children_per_line: 3,
        max_children_per_line: 3,
        homogeneous: true,
        column_spacing: 12,
        row_spacing: 12,
        margin_top: 12,
        margin_bottom: 6,
    });
    const origin = GLib.get_monotonic_time();
    const animated = () => settings.get_boolean('weather-animated');
    const areas = [];

    WEATHER_SAMPLES().forEach(([kind, night, title]) => {
        const area = new Gtk.DrawingArea({content_width: 110, content_height: 80, halign: Gtk.Align.CENTER});
        area.set_draw_func((_area, cr, width, height) => {
            roundedRect(cr, 0, 0, width, height, 14);
            cr.setSourceRGBA(0.12, 0.12, 0.14, 0.92);
            cr.fill();
            const time = animated() ? (GLib.get_monotonic_time() - origin) / GLib.USEC_PER_SEC : STILL_TIME;
            cr.translate(10, 8);
            drawWeather(cr, width - 20, height - 16, kind, night, time);
        });
        area.add_tick_callback(() => {
            if (animated())
                area.queue_draw();
            return GLib.SOURCE_CONTINUE;
        });
        areas.push(area);

        const tile = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        tile.append(area);
        tile.append(new Gtk.Label({label: title, css_classes: ['dim-label', 'caption']}));
        gallery.append(tile);
    });

    onSettingChanged(settings, 'weather-animated', () => areas.forEach(area => area.queue_draw()));
    return gallery;
}

function popoverArt(options) {
    return addArt(120, 96, (cr, width, height) => paintPopover(cr, width, height, options));
}

class CalendarPreview {
    constructor(settings) {
        this._settings = settings;
        this.widget = new Gtk.DrawingArea({content_height: PREVIEW_HEIGHT, hexpand: true});
        this.widget.set_draw_func((_area, cr, width, height) => {
            roundedRect(cr, 0, 0, width, height, 14);
            cr.clip();
            paintBackdrop(cr, width, height);
            paintPopover(cr, width, height, {
                layout: this._settings.get_string('calendar-layout'),
                clockStyle: this._settings.get_string('clock-style'),
                events: this._settings.get_boolean('show-events'),
                header: this._settings.get_boolean('show-date-header'),
                weather: true,
            });
        });
        watchAccent(this.widget);
    }

    redraw() {
        this.widget.queue_draw();
    }
}

export function buildCalendarPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Calendar'),
        icon_name: 'x-office-calendar-symbolic',
    });

    const preview = new CalendarPreview(settings);
    const heroGroup = addGroup(page, _('Calendar Popover'),
        _('World clocks and weather appear once they are set in GNOME Clocks and Weather'));
    addGroupReset(heroGroup, settings, CALENDAR_KEYS);
    heroGroup.add(preview.widget);

    const layoutGroup = addGroup(page, _('Layout'));
    addChoiceCards(layoutGroup, settings, 'calendar-layout', [
        {
            value: 'stacked',
            title: _('Stacked'),
            description: _('Everything in one column'),
            art: popoverArt({layout: 'stacked', clockStyle: 'analog', events: false, header: false, weather: false}),
        },
        {
            value: 'wide',
            title: _('Two Columns'),
            description: _('Weather, clocks and events beside the calendar'),
            art: popoverArt({layout: 'wide', clockStyle: 'analog', events: true, header: false, weather: true}),
        },
    ]);

    const clocksGroup = addGroup(page, _('World Clocks'));
    addChoiceCards(clocksGroup, settings, 'clock-style', [
        {
            value: 'analog',
            title: _('Analog'),
            description: _('Clock faces, four per page'),
            art: addArt(84, 60, (cr, width, height) => clocksSection('analog').paint(cr, (width - 72) / 2, (height - 72) / 2, 72)),
        },
        {
            value: 'compact',
            title: _('Compact List'),
            description: _('Six per page, time on the right'),
            art: addArt(84, 60, (cr, width, height) => clocksSection('compact').paint(cr, (width - 72) / 2, (height - 72) / 2, 72)),
        },
    ]);

    const weatherGroup = addGroup(page, _('Weather'), _('How the weather card looks for every kind of sky'));
    addSwitchRow(weatherGroup, settings, 'weather-animated', _('Animated Weather'),
        _('Moving sun, clouds, rain and lightning. Off shows a still picture'));
    weatherGroup.add(weatherGallery(settings));

    const sectionsGroup = addGroup(page, _('Sections'));
    addSwitchRow(sectionsGroup, settings, 'show-events', _('Events'), _('Appointments of the selected day'));
    addSwitchRow(sectionsGroup, settings, 'show-date-header', _('Date Header'), _('Weekday and date above the calendar'));
    addSwitchRow(sectionsGroup, settings, 'show-setup-hints', _('Setup Shortcuts'),
        _('“Add World Clocks…” and “Select Weather Location…” when nothing is set'));

    PREVIEW_KEYS.forEach(key => onSettingChanged(settings, key, () => preview.redraw()));

    window.add(page);
}