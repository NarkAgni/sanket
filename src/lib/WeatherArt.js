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


import Cairo from 'cairo';


const SUN = [1, 0.8, 0.29];
const SUN_RAY = [1, 0.69, 0.13];
const MOON = [0.95, 0.93, 0.82];
const CLOUD = [0.93, 0.95, 0.98];
const DARK_CLOUD = [0.55, 0.58, 0.66];
const RAIN = [0.55, 0.78, 1];
const BOLT = [1, 0.9, 0.35];
const STARS = [[0.18, 0.22, 0.9], [0.32, 0.7, 1.7], [0.82, 0.18, 2.3], [0.88, 0.62, 1.1], [0.62, 0.86, 2.9]];

const KINDS = [
    ['storm', 'storm'],
    ['snow', 'snow'],
    ['shower', 'rain'],
    ['rain', 'rain'],
    ['fog', 'fog'],
    ['windy', 'fog'],
    ['overcast', 'overcast'],
    ['few-clouds', 'partly'],
    ['clouds', 'partly'],
    ['clear', 'clear'],
];

export function weatherKind(iconName) {
    const match = KINDS.find(([part]) => iconName.includes(part));
    return match ? match[1] : 'overcast';
}

function paint(cr, [red, green, blue], alpha = 1) {
    cr.setSourceRGBA(red, green, blue, alpha);
}

function drawSun(cr, x, y, radius, time) {
    paint(cr, SUN_RAY);
    cr.setLineWidth(radius * 0.22);
    for (let ray = 0; ray < 8; ray++) {
        const angle = time * 0.5 + ray * Math.PI / 4;
        const reach = radius * (1.42 + 0.08 * Math.sin(time * 3 + ray));
        cr.moveTo(x + Math.cos(angle) * radius * 1.2, y + Math.sin(angle) * radius * 1.2);
        cr.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
        cr.stroke();
    }

    paint(cr, SUN);
    cr.arc(x, y, radius, 0, 2 * Math.PI);
    cr.fill();
}

function drawMoon(cr, x, y, radius, time, width, height) {
    STARS.forEach(([starX, starY, phase]) => {
        paint(cr, MOON, 0.25 + 0.75 * Math.abs(Math.sin(time * 1.4 + phase)));
        cr.arc(starX * width, starY * height, Math.max(radius * 0.08, 0.8), 0, 2 * Math.PI);
        cr.fill();
    });

    cr.pushGroup();
    paint(cr, MOON);
    cr.arc(x, y, radius, 0, 2 * Math.PI);
    cr.fill();
    cr.setOperator(Cairo.Operator.CLEAR);
    cr.arc(x + radius * 0.55, y - radius * 0.35, radius * 0.85, 0, 2 * Math.PI);
    cr.fill();
    cr.popGroupToSource();
    cr.paint();
}

function drawCloud(cr, x, y, size, color, alpha = 1) {
    paint(cr, color, alpha);
    cr.arc(x - size * 0.55, y, size * 0.42, 0, 2 * Math.PI);
    cr.fill();
    cr.arc(x - size * 0.05, y - size * 0.28, size * 0.55, 0, 2 * Math.PI);
    cr.fill();
    cr.arc(x + size * 0.5, y - size * 0.02, size * 0.4, 0, 2 * Math.PI);
    cr.fill();
    roundedBase(cr, x - size * 0.55, y - size * 0.1, size * 1.05, size * 0.52, size * 0.26);
    cr.fill();
}

function roundedBase(cr, x, y, width, height, radius) {
    cr.newSubPath();
    cr.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
    cr.lineTo(x, y);
    cr.lineTo(x + width, y);
    cr.closePath();
}

function drawRain(cr, x, y, width, height, time, count) {
    paint(cr, RAIN, 0.9);
    cr.setLineWidth(Math.max(height * 0.045, 1.2));
    for (let drop = 0; drop < count; drop++) {
        const offset = ((time * 1.6 + drop * 0.37) % 1) * height;
        const dropX = x + (drop + 0.5) / count * width - offset * 0.18;
        cr.moveTo(dropX, y + offset);
        cr.lineTo(dropX - height * 0.08, y + offset + height * 0.28);
        cr.stroke();
    }
}

function drawSnow(cr, x, y, width, height, time, count) {
    paint(cr, CLOUD, 0.95);
    for (let flake = 0; flake < count; flake++) {
        const offset = ((time * 0.45 + flake * 0.29) % 1) * height;
        const sway = Math.sin(time * 2 + flake) * width * 0.04;
        cr.arc(x + (flake + 0.5) / count * width + sway, y + offset, Math.max(height * 0.06, 1.2), 0, 2 * Math.PI);
        cr.fill();
    }
}

function drawBolt(cr, x, y, size, time) {
    const cycle = time % 3.2;
    if (cycle > 0.35)
        return;

    const alpha = cycle < 0.12 || (cycle > 0.2 && cycle < 0.3) ? 1 : 0.35;
    paint(cr, BOLT, alpha);
    cr.moveTo(x, y);
    cr.lineTo(x - size * 0.35, y + size * 0.55);
    cr.lineTo(x - size * 0.05, y + size * 0.55);
    cr.lineTo(x - size * 0.3, y + size);
    cr.lineTo(x + size * 0.3, y + size * 0.35);
    cr.lineTo(x, y + size * 0.35);
    cr.lineTo(x + size * 0.2, y);
    cr.closePath();
    cr.fill();
}

function drawFog(cr, width, height, time) {
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(height * 0.09);
    [0.3, 0.5, 0.7].forEach((row, index) => {
        const shift = Math.sin(time * 0.8 + index * 1.7) * width * 0.08;
        paint(cr, CLOUD, 0.45 + index * 0.15);
        cr.moveTo(width * (0.18 + index * 0.05) + shift, height * row);
        cr.lineTo(width * (0.82 - index * 0.04) + shift, height * row);
        cr.stroke();
    });
}
export function drawWeather(cr, width, height, kind, night, time) {
    const unit = Math.min(width, height);
    const drift = Math.sin(time * 0.7) * width * 0.04;
    const lit = (x, y, radius) => night
        ? drawMoon(cr, x, y, radius, time, width, height)
        : drawSun(cr, x, y, radius, time);

    cr.setLineCap(Cairo.LineCap.ROUND);

    if (kind === 'clear') {
        lit(width / 2, height / 2, unit * 0.26);
    } else if (kind === 'partly') {
        lit(width * 0.62, height * 0.36, unit * 0.2);
        drawCloud(cr, width * 0.45 + drift, height * 0.66, unit * 0.48, CLOUD);
    } else if (kind === 'overcast') {
        drawCloud(cr, width * 0.62 - drift, height * 0.44, unit * 0.4, DARK_CLOUD);
        drawCloud(cr, width * 0.42 + drift, height * 0.64, unit * 0.48, CLOUD);
    } else if (kind === 'fog') {
        drawFog(cr, width, height, time);
    } else {
        const storm = kind === 'storm';
        const top = height * 0.58;
        if (kind === 'snow')
            drawSnow(cr, width * 0.24, top, width * 0.52, height * 0.42, time, 6);
        else
            drawRain(cr, width * 0.27, top, width * 0.52, height * 0.42, time, storm ? 7 : 5);
        if (storm)
            drawBolt(cr, width * 0.55, height * 0.52, unit * 0.42, time);
        drawCloud(cr, width / 2 + drift, height * 0.46, unit * 0.44, storm ? DARK_CLOUD : CLOUD);
    }
}