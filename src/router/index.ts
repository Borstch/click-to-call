import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import Home from '../views/Home.vue';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/call',
    name: 'Home',
    component: Home,
  },
];

const router = createRouter({
  history: createWebHistory('/call/'),
  routes,
});

export default router;
