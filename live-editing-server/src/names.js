import crypto from 'node:crypto';

const ADJECTIVES = [
    'Happy', 'Brave', 'Clever', 'Sunny', 'Swift', 'Quiet', 'Lucky', 'Witty',
    'Jolly', 'Bold', 'Calm', 'Eager', 'Fancy', 'Gentle', 'Merry', 'Noble',
    'Proud', 'Silly', 'Snappy', 'Spry', 'Tidy', 'Zesty', 'Bright', 'Cosmic',
    'Dapper', 'Fuzzy', 'Groovy', 'Humble', 'Mighty', 'Plucky', 'Rowdy', 'Sleepy',
];

const ANIMALS = [
    'Capybara', 'Otter', 'Pangolin', 'Axolotl', 'Narwhal', 'Quokka', 'Lemur',
    'Badger', 'Falcon', 'Gecko', 'Heron', 'Ibex', 'Jackal', 'Koala', 'Lynx',
    'Manatee', 'Numbat', 'Ocelot', 'Puffin', 'Raccoon', 'Sloth', 'Tapir',
    'Urchin', 'Vulture', 'Walrus', 'Yak', 'Zebra', 'Wombat', 'Meerkat',
    'Platypus', 'Hedgehog', 'Marmot',
];

const pick = (list) => list[crypto.randomInt(list.length)];

export function randomName(taken = new Set()) {
    for (let i = 0; i < 40; i++) {
        const name = `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
        if (!taken.has(name)) return name;
    }
    const base = `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
    for (let n = 2; ; n++) {
        if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
    }
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY346789';

export function randomCode(length = 6) {
    let out = '';
    for (let i = 0; i < length; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];

    return out;
}

export function normaliseCode(input) {
    return String(input ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function randomId() {
    return crypto.randomBytes(8).toString('hex');
}

export const MEMBER_COLORS = [
    '#e0574f', '#4db84b', '#e0a23a', '#8a5cd6', '#3ab3c4', '#d95fa8',
    '#7cb342', '#f0762c', '#5d8bf0', '#c2b135', '#40c08a', '#d0517c',
    '#9c7be0', '#57a5e0', '#b0863a', '#6fbf5a',
];
