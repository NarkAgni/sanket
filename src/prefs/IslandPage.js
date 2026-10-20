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
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {onSettingChanged} from './SettingsSignals.js';
import {
    accentColor, addArt, addChoiceCards, addGroup, addGroupReset, addSwitchRow, fillRect, paintBackdrop,
    paintCard, roundedRect, watchAccent,
} from './PrefsWidgets.js';


const PREVIEW_HEIGHT = 260;
const TOGGLES = 6;
const CHECKED_TOGGLES = [0, 1, 3];
const SCROLLBAR_ALPHA = {auto: 0.3, always: 0.75, never: 0};
const SLIDERS = [['compact-show-volume', 0.7], ['compact-show-brightness', 0.45]];

function paintNotification(cr, x, y, width, height) {
    fillRect(cr, x, y, width, height, 12, 0.07);
    cr.setSourceRGBA(1, 1, 1, 0.5);
    cr.arc(x + 16, y + 14, 5, 0, 2 * Math.PI);
    cr.fill();
    fillRect(cr, x + 26, y + 11, width * 0.3, 6, 3, 0.45);
    fillRect(cr, x + 10, y + 24, width * 0.55, 6, 3, 0.75);
    fillRect(cr, x + 10, y + 34, width * 0.75, 5, 2.5, 0.35);
}

function paintScrollbar(cr, x, y, height, alpha) {
    if (alpha === 0)
        return;

    fillRect(cr, x, y, 4, height, 2, alpha * 0.4);
    fillRect(cr, x, y, 4, height * 0.45, 2, alpha);
}

class IslandPreview {
    constructor(settings) {
        this._settings = settings;
        this.widget = new Gtk.DrawingArea({content_height: PREVIEW_HEIGHT, hexpand: true});
        this.widget.set_draw_func((_area, cr, width, height) => this._draw(cr, width, height));
        watchAccent(this.widget);
    }

    redraw() {
        this.widget.queue_draw();
    }

    _draw(cr, width, height) {
        roundedRect(cr, 0, 0, width, height, 14);
        cr.clip();
        paintBackdrop(cr, width, height);

        const cardWidth = Math.min(280, width - 40);
        const x = width - cardWidth - 20;
        const sliders = SLIDERS.filter(([key]) => this._settings.get_boolean(key));
        const quickHeight = 64 + sliders.length * 20;
        let y = 14;

        paintCard(cr, x, y, cardWidth, quickHeight, 20);
        fillRect(cr, x + 14, y + 12, 46, 12, 6, 0.25);
        for (let index = 0; index < 3; index++) {
            cr.setSourceRGBA(1, 1, 1, 0.25);
            cr.arc(x + cardWidth - 20 - index * 20, y + 18, 7, 0, 2 * Math.PI);
            cr.fill();
        }
        y += 34;

        sliders.forEach(([, level]) => {
            fillRect(cr, x + 14, y + 4, cardWidth - 28, 8, 4, 0.15);
            fillRect(cr, x + 14, y + 4, (cardWidth - 28) * level, 8, 4, 0.85);
            y += 20;
        });

        const {red, green, blue} = accentColor();
        const step = (cardWidth - 28) / TOGGLES;
        for (let index = 0; index < TOGGLES; index++) {
            if (CHECKED_TOGGLES.includes(index))
                cr.setSourceRGBA(red, green, blue, 1);
            else
                cr.setSourceRGBA(1, 1, 1, 0.15);
            cr.arc(x + 14 + step * (index + 0.5), y + 11, 11, 0, 2 * Math.PI);
            cr.fill();
        }

        const islandY = 14 + quickHeight + 10;
        const islandHeight = height - islandY - 14;
        paintCard(cr, x, islandY, cardWidth, islandHeight, 20);

        cr.save();
        roundedRect(cr, x, islandY, cardWidth, islandHeight, 20);
        cr.clip();
        for (let rowY = islandY + 14; rowY < islandY + islandHeight; rowY += 52)
            paintNotification(cr, x + 14, rowY, cardWidth - 40, 46);
        cr.restore();

        const mode = this._settings.get_string('scrollbar-mode');
        paintScrollbar(cr, x + cardWidth - 16, islandY + 18, islandHeight - 36, SCROLLBAR_ALPHA[mode]);
    }
}

function scrollbarArt(alpha, dashed) {
    return addArt(84, 54, (cr, width, height) => {
        roundedRect(cr, 1, 1, width - 2, height - 2, 8);
        cr.setSourceRGBA(1, 1, 1, 0.08);
        cr.fillPreserve();
        cr.setSourceRGBA(1, 1, 1, 0.3);
        cr.setLineWidth(1);
        cr.stroke();

        [10, 24, 38].forEach(lineY => fillRect(cr, 10, lineY, width - 32, 7, 3.5, 0.35));

        if (dashed) {
            cr.setSourceRGBA(1, 1, 1, 0.35);
            cr.setDash([3, 3], 0);
            cr.moveTo(width - 12, 8);
            cr.lineTo(width - 12, height - 8);
            cr.stroke();
        } else {
            paintScrollbar(cr, width - 14, 8, height - 16, alpha);
        }
    });
}

export function buildIslandPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Island'),
        icon_name: 'preferences-system-notifications-symbolic',
    });

    const preview = new IslandPreview(settings);
    const heroGroup = addGroup(page, _('Notification Island'),
        _('Notifications float in their own card below Quick Settings'));
    heroGroup.add(preview.widget);

    const scrollGroup = addGroup(page, _('Scrollbar'), _('When the notification list shows its scrollbar'));
    addGroupReset(scrollGroup, settings, ['scrollbar-mode']);
    addChoiceCards(scrollGroup, settings, 'scrollbar-mode', [
        {value: 'auto', title: _('While Scrolling'), description: _('Appears near the pointer'), art: scrollbarArt(0.6, true)},
        {value: 'always', title: _('Always'), description: _('Stays on screen'), art: scrollbarArt(0.85, false)},
        {value: 'never', title: _('Never'), description: _('Scroll without a bar'), art: scrollbarArt(0, false)},
    ]);

    const quickGroup = addGroup(page, _('Compact Quick Settings'),
        _('With many notifications the toggles collapse into circles to make room'));
    addGroupReset(quickGroup, settings, SLIDERS.map(([key]) => key));
    addSwitchRow(quickGroup, settings, 'compact-show-volume', _('Volume'),
        _('Keep the volume slider while the toggles are collapsed'));
    addSwitchRow(quickGroup, settings, 'compact-show-brightness', _('Brightness'),
        _('Keep the brightness slider while the toggles are collapsed'));

    ['scrollbar-mode', ...SLIDERS.map(([key]) => key)].forEach(key =>
        onSettingChanged(settings, key, () => preview.redraw()));

    window.add(page);
}