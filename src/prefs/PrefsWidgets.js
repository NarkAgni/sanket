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
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import cairo from 'gi://cairo';

import {makeGroupResetButton} from './ResetButtons.js';
import {onSettingChanged} from './SettingsSignals.js';


const SLIDER_WIDTH = 200;
const SLIDER_HEIGHT = 34;
const SLIDER_PADDING = 8;
const FALLBACK_ACCENT = '#3584e4';
const GNOME_ACCENTS = {
    blue: '#3584e4',
    teal: '#2190a4',
    green: '#3a944a',
    yellow: '#c88800',
    orange: '#ed5b00',
    red: '#e62d42',
    pink: '#d56199',
    purple: '#9141ac',
    slate: '#6f8396',
};

let sliderCss = null;

export const fmt = {
    ms: value => `${Math.round(value)} ms`,
    times: value => `${value.toFixed(2)}×`,
};

function parseColor(hex) {
    const rgba = new Gdk.RGBA();
    rgba.parse(hex);
    return rgba;
}

export function accentColor() {
    const styleManager = Adw.StyleManager.get_default();
    if (styleManager.get_accent_color_rgba)
        return styleManager.get_accent_color_rgba();

    const schema = Gio.SettingsSchemaSource.get_default().lookup('org.gnome.desktop.interface', true);
    if (!schema || !schema.has_key('accent-color'))
        return parseColor(FALLBACK_ACCENT);

    const name = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).get_string('accent-color');
    return parseColor(GNOME_ACCENTS[name] || FALLBACK_ACCENT);
}

export function watchAccent(area) {
    const styleManager = Adw.StyleManager.get_default();
    if (!styleManager.get_accent_color_rgba)
        return;

    const id = styleManager.connect('notify::accent-color-rgba', () => area.queue_draw());
    area.connect('destroy', () => styleManager.disconnect(id));
}

export function addGroup(page, title = '', description = '') {
    const group = new Adw.PreferencesGroup({title, description});
    page.add(group);
    return group;
}

export function addGroupReset(group, settings, keys) {
    group.set_header_suffix(makeGroupResetButton(settings, keys));
}

export function addHeaderSwitch(group, settings, key) {
    const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
    settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.set_header_suffix(toggle);
    return toggle;
}

export function showWhen(widget, settings, keys, isVisible) {
    const sync = () => widget.set_visible(isVisible());
    keys.forEach(key => onSettingChanged(settings, key, sync));
    sync();
}

export function addSwitchRow(group, settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
    return row;
}

function ensureSliderCss() {
    if (sliderCss)
        return;

    sliderCss = new Gtk.CssProvider();
    sliderCss.load_from_string('.sanket-slider-value { font-weight: 600; font-feature-settings: "tnum"; }');
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), sliderCss,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
}

function drawTrack(cr, x, y, width, height, roundStart, roundEnd) {
    const radius = Math.min(height / 2, width / 2);
    const startRadius = roundStart ? radius : 2;
    const endRadius = roundEnd ? radius : 2;

    cr.newSubPath();
    cr.arc(x + startRadius, y + startRadius, startRadius, Math.PI, 1.5 * Math.PI);
    cr.arc(x + width - endRadius, y + endRadius, endRadius, -Math.PI / 2, 0);
    cr.arc(x + width - endRadius, y + height - endRadius, endRadius, 0, Math.PI / 2);
    cr.arc(x + startRadius, y + height - startRadius, startRadius, Math.PI / 2, Math.PI);
    cr.closePath();
    cr.fill();
}

export function addSliderRow(group, settings, key, title, subtitle, range, format) {
    ensureSliderCss();

    const row = new Adw.ActionRow({title, subtitle: subtitle || ''});
    const adjustment = new Gtk.Adjustment({
        lower: range.lower,
        upper: range.upper,
        step_increment: range.step,
        page_increment: range.step * 5,
    });
    settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const decimals = range.step < 1 ? 2 : 0;
    const snap = raw => {
        const clamped = Math.max(range.lower, Math.min(range.upper, raw));
        const steps = Math.round((clamped - range.lower) / range.step);
        return Number((range.lower + steps * range.step).toFixed(decimals));
    };

    const valueLabel = new Gtk.Label({
        label: format(adjustment.get_value()),
        css_classes: ['sanket-slider-value'],
        xalign: 1,
        width_chars: 6,
        valign: Gtk.Align.CENTER,
    });

    const area = new Gtk.DrawingArea({
        content_width: SLIDER_WIDTH,
        content_height: SLIDER_HEIGHT,
        valign: Gtk.Align.CENTER,
        focusable: true,
    });

    const totalSteps = Math.max(1, Math.round((range.upper - range.lower) / range.step));
    const dotSteps = totalSteps <= 12 ? totalSteps : 10;

    area.set_draw_func((_area, cr, width, height) => {
        const trackX = SLIDER_PADDING;
        const trackWidth = width - SLIDER_PADDING * 2;
        const trackHeight = 14;
        const trackY = (height - trackHeight) / 2;
        const centerY = height / 2;
        const thumbGap = 5;
        const ratio = (adjustment.get_value() - range.lower) / (range.upper - range.lower);
        const thumbX = trackX + Math.max(0, Math.min(1, ratio)) * trackWidth;
        const {red, green, blue} = accentColor();

        const startWidth = thumbX - thumbGap - trackX;
        if (startWidth > 2) {
            cr.setSourceRGBA(red, green, blue, 1);
            drawTrack(cr, trackX, trackY, startWidth, trackHeight, true, false);
        }

        const endX = thumbX + thumbGap;
        const endWidth = trackX + trackWidth - endX;
        if (endWidth > 2) {
            cr.setSourceRGBA(red, green, blue, 0.22);
            drawTrack(cr, endX, trackY, endWidth, trackHeight, false, true);
        }

        for (let step = 0; step <= dotSteps; step++) {
            const dotX = trackX + 6 + step / dotSteps * (trackWidth - 12);
            if (Math.abs(dotX - thumbX) < thumbGap + 3)
                continue;

            if (dotX < thumbX)
                cr.setSourceRGBA(1, 1, 1, 0.92);
            else
                cr.setSourceRGBA(red, green, blue, 0.85);
            cr.arc(dotX, centerY, 1.8, 0, 2 * Math.PI);
            cr.fill();
        }

        roundedRect(cr, thumbX - 2, centerY - 13, 4, 26, 2);
        cr.setSourceRGBA(red, green, blue, 1);
        cr.fill();
    });
    watchAccent(area);

    const setFromX = x => {
        const trackWidth = (area.get_width() || SLIDER_WIDTH) - SLIDER_PADDING * 2;
        const ratio = Math.max(0, Math.min(1, (x - SLIDER_PADDING) / trackWidth));
        adjustment.set_value(snap(range.lower + ratio * (range.upper - range.lower)));
    };
    const nudge = direction => adjustment.set_value(snap(adjustment.get_value() + direction * range.step));

    const drag = new Gtk.GestureDrag();
    let dragStart = 0;
    drag.connect('drag-begin', (_gesture, x) => {
        dragStart = x;
        area.grab_focus();
        setFromX(x);
    });
    drag.connect('drag-update', (_gesture, offsetX) => setFromX(dragStart + offsetX));
    area.add_controller(drag);

    const scroll = new Gtk.EventControllerScroll({flags: Gtk.EventControllerScrollFlags.VERTICAL});
    scroll.connect('scroll', (_controller, _dx, dy) => {
        nudge(dy < 0 ? 1 : -1);
        return Gdk.EVENT_STOP;
    });
    area.add_controller(scroll);

    const keys = new Gtk.EventControllerKey();
    keys.connect('key-pressed', (_controller, keyval) => {
        if (keyval === Gdk.KEY_Left || keyval === Gdk.KEY_Down) {
            nudge(-1);
            return Gdk.EVENT_STOP;
        }
        if (keyval === Gdk.KEY_Right || keyval === Gdk.KEY_Up) {
            nudge(1);
            return Gdk.EVENT_STOP;
        }
        return Gdk.EVENT_PROPAGATE;
    });
    area.add_controller(keys);

    adjustment.connect('value-changed', () => {
        valueLabel.set_label(format(adjustment.get_value()));
        area.queue_draw();
    });

    const box = new Gtk.Box({spacing: 12, valign: Gtk.Align.CENTER});
    box.append(valueLabel);
    box.append(area);
    row.add_suffix(box);
    group.add(row);
    return row;
}

export function bindChoice(settings, key, buttons) {
    const sync = () => {
        const button = buttons.get(settings.get_string(key));
        if (button && !button.get_active())
            button.set_active(true);
    };
    buttons.forEach((button, value) => {
        button.connect('toggled', () => {
            if (button.get_active() && settings.get_string(key) !== value)
                settings.set_string(key, value);
        });
    });
    onSettingChanged(settings, key, sync);
    sync();
}

export function addSegmentedRow(group, settings, key, title, subtitle, options) {
    const row = new Adw.ActionRow({title, subtitle: subtitle || ''});
    const box = new Gtk.Box({valign: Gtk.Align.CENTER, css_classes: ['linked']});
    const buttons = new Map();
    let first = null;

    options.forEach(({name, value}) => {
        const button = new Gtk.ToggleButton({label: name});
        if (first)
            button.set_group(first);
        else
            first = button;
        buttons.set(value, button);
        box.append(button);
    });
    bindChoice(settings, key, buttons);

    row.add_suffix(box);
    group.add(row);
    return row;
}

export function addChoiceCards(group, settings, key, options) {
    const box = new Gtk.Box({spacing: 12, homogeneous: true});
    const buttons = new Map();
    let first = null;

    options.forEach(option => {
        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            margin_top: 14,
            margin_bottom: 14,
            margin_start: 16,
            margin_end: 16,
        });
        content.append(option.art);
        content.append(new Gtk.Label({label: option.title, css_classes: ['heading']}));
        if (option.description) {
            content.append(new Gtk.Label({
                label: option.description,
                wrap: true,
                justify: Gtk.Justification.CENTER,
                width_chars: 1,
                css_classes: ['dim-label', 'caption'],
            }));
        }

        const button = new Gtk.ToggleButton({child: content, hexpand: true});
        if (first)
            button.set_group(first);
        else
            first = button;
        buttons.set(option.value, button);
        box.append(button);
    });

    bindChoice(settings, key, buttons);
    group.add(box);
    return box;
}

export function addArt(width, height, draw) {
    const area = new Gtk.DrawingArea({content_width: width, content_height: height, halign: Gtk.Align.CENTER});
    area.set_draw_func((_area, cr, areaWidth, areaHeight) => draw(cr, areaWidth, areaHeight));
    return area;
}

export function roundedRect(cr, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    cr.newSubPath();
    cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

export function fillRect(cr, x, y, width, height, radius, alpha) {
    roundedRect(cr, x, y, width, height, radius);
    cr.setSourceRGBA(1, 1, 1, alpha);
    cr.fill();
}

export function paintCard(cr, x, y, width, height, radius) {
    roundedRect(cr, x, y, width, height, radius);
    cr.setSourceRGBA(0.12, 0.12, 0.14, 0.92);
    cr.fill();
}

export function paintBackdrop(cr, width, height) {
    const base = new cairo.LinearGradient(0, 0, width, height);
    base.addColorStopRGB(0, 0.13, 0.19, 0.34);
    base.addColorStopRGB(1, 0.27, 0.16, 0.36);
    cr.setSource(base);
    cr.paint();

    const glow = new cairo.RadialGradient(width * 0.3, height * 0.2, 0, width * 0.3, height * 0.2, width * 0.6);
    glow.addColorStopRGBA(0, 0.98, 0.62, 0.42, 0.45);
    glow.addColorStopRGBA(1, 0.98, 0.62, 0.42, 0);
    cr.setSource(glow);
    cr.paint();
}

export function easeOutQuart(progress) {
    return 1 - Math.pow(1 - progress, 4);
}