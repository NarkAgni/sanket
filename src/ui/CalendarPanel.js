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
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import {WeatherCard} from './WeatherCard.js';
import {fadeIn, stopFade} from './Animations.js';
import {WorldClocksCard} from './WorldClocksCard.js';
import {CalendarMotion} from '../shell/CalendarMotion.js';
import {createBox, detachActor, isActorAlive} from '../lib/Utils.js';


const COLUMN_SPACING = 8;

const ColumnLayout = GObject.registerClass(
class ColumnLayout extends Clutter.BoxLayout {
    _init(anchor) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            spacing: COLUMN_SPACING * St.ThemeContext.get_for_stage(global.stage).scale_factor,
        });
        this._anchor = anchor;
    }

    vfunc_get_preferred_width(_container, forHeight) {
        return this._anchor.get_preferred_width(forHeight);
    }
});

export class CalendarPanel {
    constructor(dateMenu, settings) {
        this._dateMenu = dateMenu;
        this._settings = settings;
        this._calendar = dateMenu._calendar;
        this._date = dateMenu._date;
        this._events = dateMenu._eventsItem;
        this._dateVisible = this._date.visible;
        this._side = null;

        this._restores = [this._calendar, this._date, this._events].map(detachActor);

        this._eventsBin = new St.Bin({child: this._events, x_expand: true});
        this._clocks = new WorldClocksCard(dateMenu._clocksItem, settings);
        this._weather = new WeatherCard(dateMenu._weatherItem, settings);
        this._motion = new CalendarMotion(this._calendar);

        this.actor = createBox(false, 'sanket-calendar-panel', {y_align: Clutter.ActorAlign.START});

        const sync = () => this._sync();
        this._settings.connectObject(
            'changed::calendar-layout', () => this._build(true),
            'changed::show-events', sync,
            'changed::show-date-header', sync,
            this);
        [this._events, this._clocks.actor, this._weather.actor].forEach(actor =>
            actor.connectObject('notify::visible', sync, this));
        this._dateMenu.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this._weather.update();
        }, this);

        this._build(false);
    }

    destroy() {
        this._settings.disconnectObject(this);
        if (this._dateMenu.menu)
            this._dateMenu.menu.disconnectObject(this);
        [this._events, this._clocks.actor, this._weather.actor]
            .filter(isActorAlive)
            .forEach(actor => actor.disconnectObject(this));

        this._motion.destroy();
        stopFade(this.actor);
        if (isActorAlive(this._date))
            this._date.visible = this._dateVisible;

        [...this._restores].reverse().forEach(restore => restore());
        this._clocks.destroy();
        this._weather.destroy();
        this.actor.destroy();

        this.actor = null;
        this._side = null;
        this._eventsBin = null;
        this._restores = null;
        this._motion = null;
        this._weather = null;
        this._clocks = null;
        this._events = null;
        this._date = null;
        this._calendar = null;
        this._settings = null;
        this._dateMenu = null;
    }

    _build(animate) {
        const wide = this._settings.get_string('calendar-layout') === 'wide';

        [this._date, this._calendar, this._eventsBin, this._clocks.actor, this._weather.actor].forEach(actor => {
            const parent = actor.get_parent();
            if (parent)
                parent.remove_child(actor);
        });
        this.actor.destroy_all_children();

        if (wide) {
            this._side = this._addColumn([this._weather.actor, this._clocks.actor, this._eventsBin]);
            this._addColumn([this._date, this._calendar]);
        } else {
            this._side = null;
            this._addColumn([this._date, this._calendar, this._eventsBin, this._clocks.actor, this._weather.actor]);
        }

        this._sync();

        if (animate && this.actor.mapped) {
            this.actor.opacity = 0;
            fadeIn(this.actor);
        }
    }

    _addColumn(children) {
        const column = new St.Widget({
            style_class: 'sanket-calendar-column',
            layout_manager: new ColumnLayout(this._calendar),
            y_align: Clutter.ActorAlign.START,
        });
        children.forEach(child => column.add_child(child));
        this.actor.add_child(column);
        return column;
    }

    _sync() {
        this._date.visible = this._settings.get_boolean('show-date-header');
        this._eventsBin.visible = this._settings.get_boolean('show-events') && this._events.visible;
        if (this._side)
            this._side.visible = [this._weather.actor, this._clocks.actor, this._eventsBin].some(actor => actor.visible);
    }
}