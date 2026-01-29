import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';
import Home from '../views/Home.vue';
import { config } from '@/shared/config';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/call/:callId',
    name: 'Home',
    component: Home,
  }
];

const router = createRouter({
  history: createWebHashHistory(config.baseUrl),
  routes,
});

export default router;
