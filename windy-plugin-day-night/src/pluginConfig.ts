import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
    name: 'windy-plugin-day-night',
    version: '1.0.0',
    icon: '🌗',
    title: 'Day-Night terminator',
    description:
        'Day/night terminator with civil, nautical and astronomical twilight lines and shading. ' +
        'Follows the forecast timeline and works on both the 2D map and the 3D globe.',
    author: 'Kauswai',
    repository: 'https://github.com/Kauswai/DayNight',
    desktopUI: 'embedded',
    mobileUI: 'small',
    routerPath: '/day-night',
    private: true,
};

export default config;
