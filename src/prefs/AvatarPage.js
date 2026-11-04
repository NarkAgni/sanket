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
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {onSettingChanged} from './SettingsSignals.js';
import {
    accentColor, addArt, addChoiceCards, addGroup, addGroupReset, addSegmentedRow, addSliderRow, addSwitchRow,
    fillRect, paintBackdrop, paintCard, roundedRect, showWhen, watchAccent,
} from './PrefsWidgets.js';


const PREVIEW_HEIGHT = 120;
const BUTTON_HEIGHT = 40;
const BUTTON_GAP = 10;
const SYSTEM_BUTTONS = 4;
const BATTERY_WIDTH = 78;
const NAME_WIDTH = 64;
const LOOK_KEYS = ['user-avatar-style', 'user-avatar-position', 'user-avatar-size', 'user-avatar-name', 'user-avatar-click'];
const percent = value => `${Math.round(value * 100)}%`;

function paintPicture(cr, x, centerY, size) {
    const {red, green, blue} = accentColor();
    const centerX = x + size / 2;

    cr.save();
    cr.arc(centerX, centerY, size / 2, 0, 2 * Math.PI);
    cr.clip();
    cr.setSourceRGBA(red, green, blue, 1);
    cr.paint();
    cr.setSourceRGBA(1, 1, 1, 0.9);
    cr.arc(centerX, centerY - size * 0.12, size * 0.18, 0, 2 * Math.PI);
    cr.fill();
    cr.arc(centerX, centerY + size * 0.48, size * 0.34, 0, 2 * Math.PI);
    cr.fill();
    cr.restore();
}

function avatarWidth(pill) {
    return pill ? BUTTON_HEIGHT + NAME_WIDTH + 16 : BUTTON_HEIGHT;
}

function paintAvatar(cr, x, y, pill, scale) {
    const size = BUTTON_HEIGHT * scale;
    const inset = (BUTTON_HEIGHT - size) / 2;
    const width = avatarWidth(pill);
    fillRect(cr, x, y, width, BUTTON_HEIGHT, BUTTON_HEIGHT / 2, 0.13);
    paintPicture(cr, x + inset, y + BUTTON_HEIGHT / 2, size);
    if (pill)
        fillRect(cr, x + inset + size + 8, y + BUTTON_HEIGHT / 2 - 4, NAME_WIDTH, 8, 4, 0.85);
    return width;
}

class AvatarPreview {
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

        const pill = this._settings.get_string('user-avatar-style') === 'pill';
        const scale = this._settings.get_double('user-avatar-size');
        const shown = this._settings.get_boolean('show-user-avatar');
        const end = this._settings.get_string('user-avatar-position') === 'end';
        const avatar = shown ? avatarWidth(pill) + BUTTON_GAP : 0;
        const rowWidth = avatar + BATTERY_WIDTH + SYSTEM_BUTTONS * (BUTTON_HEIGHT + BUTTON_GAP);
        const cardWidth = Math.min(rowWidth + 28, width - 24);
        const cardX = (width - cardWidth) / 2;
        const y = (height - BUTTON_HEIGHT) / 2;

        paintCard(cr, cardX, y - 16, cardWidth, BUTTON_HEIGHT + 32, 24);
        let x = cardX + 14;
        if (shown && !end)
            x += paintAvatar(cr, x, y, pill, scale) + BUTTON_GAP;

        fillRect(cr, x, y, BATTERY_WIDTH, BUTTON_HEIGHT, BUTTON_HEIGHT / 2, 0.13);
        fillRect(cr, x + 16, y + 15, BATTERY_WIDTH - 32, 10, 5, 0.6);
        x += BATTERY_WIDTH + BUTTON_GAP;

        for (let index = 0; index < SYSTEM_BUTTONS; index++) {
            fillRect(cr, x, y, BUTTON_HEIGHT, BUTTON_HEIGHT, BUTTON_HEIGHT / 2, 0.13);
            cr.setSourceRGBA(1, 1, 1, 0.75);
            cr.arc(x + BUTTON_HEIGHT / 2, y + BUTTON_HEIGHT / 2, 6, 0, 2 * Math.PI);
            cr.fill();
            x += BUTTON_HEIGHT + BUTTON_GAP;
        }

        if (shown && end)
            paintAvatar(cr, x, y, pill, scale);
    }
}

function shapeArt(pill) {
    return addArt(150, 56, (cr, width, height) => {
        const x = (width - avatarWidth(pill)) / 2;
        paintAvatar(cr, x, (height - BUTTON_HEIGHT) / 2, pill, 1);
    });
}

export function buildAvatarPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Avatar'),
        icon_name: 'avatar-default-symbolic',
    });

    const preview = new AvatarPreview(settings);
    const heroGroup = addGroup(page, _('User Avatar'),
        _('Your picture in the Quick Settings system row, as tall as the buttons beside it'));
    heroGroup.add(preview.widget);

    const showGroup = addGroup(page);
    addSwitchRow(showGroup, settings, 'show-user-avatar', _('Show User Avatar'),
        _('Turn this off if another extension already adds one'));

    const shapeGroup = addGroup(page, _('Shape'));
    addGroupReset(shapeGroup, settings, ['user-avatar-style']);
    addChoiceCards(shapeGroup, settings, 'user-avatar-style', [
        {value: 'pill', title: _('Pill'), description: _('Picture and name'), art: shapeArt(true)},
        {value: 'circle', title: _('Circle'), description: _('Only the picture, like the other buttons'), art: shapeArt(false)},
    ]);

    const detailsGroup = addGroup(page, _('Details'));
    addGroupReset(detailsGroup, settings, LOOK_KEYS.filter(key => key !== 'user-avatar-style'));
    addSliderRow(detailsGroup, settings, 'user-avatar-size', _('Picture Size'),
        _('How much of the button the picture fills'), {lower: 0.5, upper: 1, step: 0.05}, percent);
    const nameRow = addSegmentedRow(detailsGroup, settings, 'user-avatar-name', _('Name'),
        _('Shown next to the picture'), [
            {name: _('Full Name'), value: 'real'},
            {name: _('Username'), value: 'login'},
        ]);
    showWhen(nameRow, settings, ['user-avatar-style'], () => settings.get_string('user-avatar-style') === 'pill');
    addSegmentedRow(detailsGroup, settings, 'user-avatar-position', _('Position'),
        _('Where the avatar sits in the system row'), [
            {name: _('Left'), value: 'start'},
            {name: _('Right'), value: 'end'},
        ]);
    addSegmentedRow(detailsGroup, settings, 'user-avatar-click', _('On Click'),
        _('What happens when you click the avatar'), [
            {name: _('Open Users'), value: 'users'},
            {name: _('Switch User'), value: 'switch'},
            {name: _('Nothing'), value: 'none'},
        ]);

    [shapeGroup, detailsGroup].forEach(group =>
        settings.bind('show-user-avatar', group, 'sensitive', Gio.SettingsBindFlags.GET));
    ['show-user-avatar', ...LOOK_KEYS].forEach(key => onSettingChanged(settings, key, () => preview.redraw()));

    window.add(page);
}