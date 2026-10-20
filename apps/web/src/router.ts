import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { LAST_HUNT_KEY, POST_LOGIN_KEY, readLocal, writeLocal } from '@/lib/storage'
import { adoptShareParams } from '@/lib/share'

// Hash routing: GitHub Pages has no SPA rewrites, so deep links, magic-link
// redirects and the share target all live after the "#". Shared links arrive
// as "<base>?url=…#/add"; move them into the route before the router reads it.
adoptShareParams()

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      redirect: () => {
        // Coming back from a magic link or OAuth lands on "/": resume where the user was headed.
        const next = readLocal(POST_LOGIN_KEY)
        if (next) {
          writeLocal(POST_LOGIN_KEY, null)
          return next
        }
        const last = readLocal(LAST_HUNT_KEY)
        return last ? { name: 'deck', params: { huntId: last } } : { name: 'hunts' }
      },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    { path: '/hunts', name: 'hunts', component: () => import('@/views/HuntsView.vue') },
    { path: '/hunts/new', name: 'new-hunt', component: () => import('@/views/NewHuntView.vue') },
    { path: '/account', name: 'account', component: () => import('@/views/AccountView.vue') },
    { path: '/join/:token', name: 'join', component: () => import('@/views/JoinView.vue') },
    {
      // The share target, or "add from anywhere": ?url / text / title, then pick a hunt.
      path: '/add',
      name: 'share',
      component: () => import('@/views/ShareView.vue'),
    },
    {
      path: '/notifications',
      name: 'notifications',
      component: () => import('@/views/NotificationsView.vue'),
    },
    {
      path: '/h/:huntId',
      component: () => import('@/views/HuntLayout.vue'),
      children: [
        { path: '', redirect: { name: 'deck' } },
        {
          // The Deck tab: swipe plus the Matches / Disagreements / Maybes lists.
          path: 'deck',
          component: () => import('@/views/DeckLayout.vue'),
          meta: { tab: 'deck' },
          children: [
            { path: '', name: 'deck', component: () => import('@/views/SwipeView.vue') },
            {
              path: 'matches',
              name: 'matches',
              component: () => import('@/views/DecisionListView.vue'),
              props: { kind: 'matches' },
            },
            {
              path: 'disagreements',
              name: 'disagreements',
              component: () => import('@/views/DecisionListView.vue'),
              props: { kind: 'disagreements' },
            },
            {
              path: 'maybes',
              name: 'maybes',
              component: () => import('@/views/DecisionListView.vue'),
              props: { kind: 'maybes' },
            },
          ],
        },
        {
          path: 'list',
          name: 'list',
          component: () => import('@/views/ListView.vue'),
          meta: { wide: true },
        },
        { path: 'add', name: 'add', component: () => import('@/views/AddListingView.vue') },
        {
          path: 'l/:listingId',
          name: 'listing',
          component: () => import('@/views/ListingDetailView.vue'),
        },
        {
          path: 'l/:listingId/edit',
          name: 'listing-edit',
          component: () => import('@/views/ListingEditView.vue'),
        },
        { path: 'map', name: 'map', component: () => import('@/views/MapView.vue') },
        {
          // ?ids=a,b,c: two to four listings side by side.
          path: 'compare',
          name: 'compare',
          component: () => import('@/views/CompareView.vue'),
        },
        {
          path: 'pipeline',
          name: 'pipeline',
          component: () => import('@/views/PipelineView.vue'),
          meta: { wide: true },
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/HuntSettingsView.vue'),
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()

  if (!auth.session && !to.meta.public) {
    writeLocal(POST_LOGIN_KEY, to.fullPath)
    return { name: 'login' }
  }
  if (auth.session && to.name === 'login') {
    const next = readLocal(POST_LOGIN_KEY)
    writeLocal(POST_LOGIN_KEY, null)
    return next ?? '/'
  }
})
