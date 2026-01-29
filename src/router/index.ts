import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';
import Home from '../views/Home.vue';
import Button from '@/views/Button.vue';
import { config } from '@/shared/config';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/call',
    name: 'Home',
    component: Home,
  },
  {
    path: '/button',
    name: 'Button',
    component: Button,
  },
];

const router = createRouter({
  history: createWebHashHistory(config.baseUrl),
  routes,
});

export default router;
