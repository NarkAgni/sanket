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
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import GWeather from 'gi://GWeather';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {fadeIn} from './Animations.js';
import {createBox} from '../lib/Utils.js';
import {WeatherScene} from './WeatherScene.js';
import {weatherKind} from '../lib/WeatherArt.js';


const DIM_OPACITY = 170;

function describe(kind, night) {
    const names = {
        clear: night ? _('Clear Night') : _('Clear Sky'),
        partly: _('Partly Cloudy'),
        overcast: _('Cloudy'),
        rain: _('Rain'),
        snow: _('Snow'),
        storm: _('Thunderstorm'),
        fog: _('Fog'),
    };
    return names[kind];
}

function temperatureOf(info) {
    const [valid, value] = info.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
    return valid ? Math.round(value) : null;
}

function todayRange(info) {
    const today = GLib.DateTime.new_now_local();
    const temperatures = [temperatureOf(info)];

    info.get_forecast_list().forEach(forecast => {
        const [valid, timestamp] = forecast.get_value_update();
        const date = valid ? GLib.DateTime.new_from_unix_local(timestamp) : null;
        if (date && date.get_year() === today.get_year() && date.get_day_of_year() === today.get_day_of_year())
            temperatures.push(temperatureOf(forecast));
    });

    const known = temperatures.filter(value => value !== null);
    return known.length > 1 ? [Math.max(...known), Math.min(...known)] : null;
}

function label(styleClass, props = {}) {
    const actor = new St.Label({style_class: styleClass, ...props});
    actor.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return actor;
}

export class WeatherCard {
    constructor(weatherItem, settings) {
        this._settings = settings;
        this._source = weatherItem;
        this._client = weatherItem._weatherClient;
        this._look = null;

        this._scene = new WeatherScene();
        this._hintIcon = new St.Icon({
            style_class: 'sanket-setup-hint-icon',
            icon_name: 'find-location-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._temperature = label('sanket-weather-temperature', {y_align: Clutter.ActorAlign.CENTER});
        this._summary = label('sanket-weather-summary');
        this._range = label('sanket-weather-range', {opacity: DIM_OPACITY});
        this._location = label('sanket-weather-location', {opacity: DIM_OPACITY});

        const details = createBox(true, 'sanket-weather-details', {
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        details.add_child(this._summary);
        details.add_child(this._range);
        details.add_child(this._location);

        const box = createBox(false, 'sanket-weather-box', {x_expand: true});
        [this._scene, this._hintIcon, this._temperature, details].forEach(actor => box.add_child(actor));

        this.actor = new St.Button({
            style_class: 'weather-button sanket-weather-card',
            can_focus: true,
            x_expand: true,
            visible: false,
            child: box,
        });
        this.actor.connectObject('clicked', () => this._source.emit('clicked', 1), this);
        this._client.connectObject('changed', () => this._sync(), this);
        this._settings.connectObject(
            'changed::show-setup-hints', () => this._sync(),
            'changed::weather-animated', () => this._syncAnimated(),
            this);
        this._syncAnimated();
        this._sync();
    }

    update() {
        this._client.update();
    }

    destroy() {
        this._client.disconnectObject(this);
        this._settings.disconnectObject(this);
        this.actor.destroy();

        this.actor = null;
        this._scene = null;
        this._hintIcon = null;
        this._temperature = null;
        this._summary = null;
        this._range = null;
        this._location = null;
        this._client = null;
        this._settings = null;
        this._source = null;
    }

    _sync() {
        if (!this._client.available) {
            this._setShown(false);
        } else if (!this._client.hasLocation) {
            this._showHint();
        } else if (!this._client.loading && this._client.info.is_valid()) {
            this._fill(this._client.info);
            this._setShown(true);
        }
    }

    _syncAnimated() {
        this._scene.setAnimated(this._settings.get_boolean('weather-animated'));
    }

    _setHintMode(hint) {
        this._scene.visible = !hint;
        this._temperature.visible = !hint;
        this._range.visible = !hint;
        this._location.visible = !hint;
        this._hintIcon.visible = hint;
        if (hint) {
            this._look = null;
            this.actor.add_style_class_name('sanket-setup-hint');
        } else {
            this.actor.remove_style_class_name('sanket-setup-hint');
        }
    }

    _showHint() {
        const hint = this._settings.get_boolean('show-setup-hints');
        if (hint) {
            this._setHintMode(true);
            this._summary.text = _('Select Weather Location…');
        }
        this._setShown(hint);
    }

    _fill(info) {
        const iconName = info.get_symbolic_icon_name();
        const kind = weatherKind(iconName);
        const night = iconName.includes('night') || !info.is_daytime();
        const conditions = info.get_conditions();
        const current = temperatureOf(info);
        const range = todayRange(info);

        this._setHintMode(false);
        this._setLook(kind, night);

        this._temperature.text = current === null ? '' : `${current}°`;
        this._summary.text = conditions && conditions !== '-' ? conditions : describe(kind, night);
        this._range.text = range ? `↑ ${range[0]}°   ↓ ${range[1]}°` : '';
        this._range.visible = range !== null;
        this._location.text = info.get_location_name();
    }

    _setLook(kind, night) {
        const look = `${kind}${night ? '-night' : ''}`;
        if (this._look === look)
            return;

        if (this._look && this._scene.mapped) {
            this._scene.opacity = 0;
            fadeIn(this._scene);
        }
        this._look = look;
        this._scene.setWeather(kind, night);
    }

    _setShown(shown) {
        if (this.actor.visible === shown)
            return;

        this.actor.visible = shown;
        if (shown && this.actor.mapped) {
            this.actor.opacity = 0;
            fadeIn(this.actor);
        }
    }
}