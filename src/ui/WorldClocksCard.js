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
import {formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {AnalogClock} from './AnalogClock.js';
import {easeTo, fadeIn} from './Animations.js';
import {TimeoutTracker} from '../lib/TimeoutTracker.js';
import {CHILD_ADDED, CHILD_REMOVED, createBox, isActorAlive} from '../lib/Utils.js';


const PAGE_SIZES = {analog: 4, compact: 6};
const PAGE_SHIFT = 0.35;
const DIM_OPACITY = 170;

export class WorldClocksCard {
    constructor(clocksItem, settings) {
        this._source = clocksItem;
        this._settings = settings;
        this._timers = new TimeoutTracker();
        this._rebuildId = 0;
        this._locations = [];
        this._rows = [];
        this._page = 0;
        this._pageActor = null;

        this._pages = new St.Widget({
            style_class: 'sanket-clocks-pages',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            clip_to_allocation: true,
        });
        this._dots = createBox(false, 'sanket-clocks-dots', {x_align: Clutter.ActorAlign.CENTER});

        this._placeholder = createBox(false, 'sanket-setup-hint', {visible: false});
        this._placeholder.add_child(new St.Icon({
            style_class: 'sanket-setup-hint-icon',
            icon_name: 'list-add-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._placeholder.add_child(new St.Label({
            text: _('Add World Clocks…'),
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const content = createBox(true, 'sanket-clocks-box', {x_expand: true});
        content.add_child(this._pages);
        content.add_child(this._dots);
        content.add_child(this._placeholder);

        this.actor = new St.Button({
            style_class: 'world-clocks-button sanket-clocks-card',
            can_focus: true,
            x_expand: true,
            visible: false,
            child: content,
        });
        this.actor.connectObject(
            'clicked', () => this._source.emit('clicked', 1),
            'scroll-event', (_actor, event) => this._onScroll(event),
            this);

        const queue = () => this._queueRebuild();
        this._source.connectObject('notify::visible', () => this._syncShown(), this);
        this._source._grid.connectObject(CHILD_ADDED, queue, CHILD_REMOVED, queue, this);
        this._source._clock.connectObject('notify::clock', () => this._updateTimes(), this);
        this._settings.connectObject(
            'changed::clock-style', () => this._rebuild(),
            'changed::show-setup-hints', () => this._syncShown(),
            this);
        this._rebuild();
    }

    destroy() {
        this._timers.destroy();
        if (isActorAlive(this._source)) {
            this._source.disconnectObject(this);
            this._source._grid.disconnectObject(this);
            this._source._clock.disconnectObject(this);
        }
        this._settings.disconnectObject(this);
        this.actor.destroy();

        this.actor = null;
        this._pages = null;
        this._dots = null;
        this._placeholder = null;
        this._pageActor = null;
        this._rows = null;
        this._locations = null;
        this._settings = null;
        this._source = null;
    }

    _queueRebuild() {
        if (this._rebuildId)
            return;

        this._rebuildId = this._timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildId = 0;
            this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _style() {
        return this._settings.get_string('clock-style') === 'compact' ? 'compact' : 'analog';
    }

    _pageCount() {
        return Math.ceil(this._locations.length / PAGE_SIZES[this._style()]);
    }

    _rebuild() {
        this._locations = this._source._locations.map(({location}) => location);
        this._page = Math.min(this._page, Math.max(this._pageCount() - 1, 0));
        this._showPage(0);
        this._syncShown();
    }

    _syncShown() {
        const empty = this._locations.length === 0;
        const hint = empty && this._source.visible && this._settings.get_boolean('show-setup-hints');

        this._pages.visible = !empty;
        this._placeholder.visible = hint;
        this.actor.reactive = !empty || hint;
        this._setShown(!empty || hint);
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

    _showPage(direction) {
        const style = this._style();
        const size = PAGE_SIZES[style];
        const page = createBox(true, 'sanket-clocks-page', {x_expand: true, y_align: Clutter.ActorAlign.START});
        const previous = this._pageActor;

        this._rows = this._locations
            .slice(this._page * size, (this._page + 1) * size)
            .map(location => this._createRow(location, style));
        this._rows.forEach(row => page.add_child(row.actor));

        this._pageActor = page;
        this._pages.add_child(page);
        this._updateTimes();
        this._syncDots();

        if (!previous)
            return;

        if (direction === 0 || !this._pages.mapped) {
            previous.destroy();
            return;
        }

        const rtl = this._pages.get_text_direction() === Clutter.TextDirection.RTL ? -1 : 1;
        const shift = Math.round(this._pages.width * PAGE_SHIFT) * direction * rtl;
        easeTo(previous, {translation_x: -shift, opacity: 0}, () => previous.destroy());
        page.translation_x = shift;
        page.opacity = 0;
        easeTo(page, {translation_x: 0, opacity: 255});
    }

    _createRow(location, style) {
        const compact = style === 'compact';
        const clock = new AnalogClock(compact);
        const city = new St.Label({
            style_class: 'sanket-clock-city',
            text: location.get_city_name() || location.get_name(),
            x_expand: compact,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const time = new St.Label({
            style_class: 'sanket-clock-time',
            y_align: Clutter.ActorAlign.CENTER,
            opacity: DIM_OPACITY,
        });
        time.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        const actor = createBox(false, `sanket-clock-row sanket-clock-row-${style}`, {x_expand: true});
        actor.add_child(clock);
        if (compact) {
            actor.add_child(city);
            actor.add_child(time);
        } else {
            const text = createBox(true, 'sanket-clock-text', {y_align: Clutter.ActorAlign.CENTER});
            text.add_child(city);
            text.add_child(time);
            actor.add_child(text);
        }

        return {actor, clock, time, timezone: location.get_timezone()};
    }

    _updateTimes() {
        this._rows.forEach(({clock, time, timezone}) => {
            const now = GLib.DateTime.new_now(timezone);
            time.text = formatTime(now, {timeOnly: true});
            clock.setTime(now.get_hour(), now.get_minute());
        });
    }

    _syncDots() {
        const count = this._pageCount();
        this._dots.destroy_all_children();
        this._dots.visible = count > 1;

        for (let index = 0; index < count; index++) {
            const dot = new St.Button({
                style_class: 'sanket-clocks-dot',
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            if (index === this._page)
                dot.add_style_pseudo_class('checked');
            dot.connectObject('clicked', () => this._goTo(index), this);
            this._dots.add_child(dot);
        }
    }

    _goTo(page) {
        if (page === this._page || page < 0 || page >= this._pageCount())
            return;

        const direction = Math.sign(page - this._page);
        this._page = page;
        this._showPage(direction);
    }

    _onScroll(event) {
        if (this._pageCount() < 2 || this._pageActor.get_transition('translation-x'))
            return Clutter.EVENT_PROPAGATE;

        const scroll = event.get_scroll_direction();
        let step = 0;
        if (scroll === Clutter.ScrollDirection.UP || scroll === Clutter.ScrollDirection.LEFT) {
            step = -1;
        } else if (scroll === Clutter.ScrollDirection.DOWN || scroll === Clutter.ScrollDirection.RIGHT) {
            step = 1;
        } else {
            const [dx, dy] = event.get_scroll_delta();
            step = Math.sign(Math.abs(dx) > Math.abs(dy) ? dx : dy);
        }

        if (step === 0)
            return Clutter.EVENT_PROPAGATE;

        this._goTo(this._page + step);
        return Clutter.EVENT_STOP;
    }
}