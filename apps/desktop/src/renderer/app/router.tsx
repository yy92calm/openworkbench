import { createHashRouter, Navigate, type RouteObject } from 'react-router-dom';

import { AppShell } from './layout/AppShell';
import { FilesPage } from './routes/FilesPage';
import { LiveSessionPage } from './routes/LiveSessionPage';
import { NotFound } from './routes/NotFound';
import { RoomsPage } from './routes/RoomsPage';
import { SessionPage } from './routes/SessionPage';
import { SettingsPage } from './routes/SettingsPage';
import { SkillsPage } from './routes/SkillsPage';
import { TasksPage } from './routes/TasksPage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/live" replace /> },
      { path: 'live', element: <LiveSessionPage /> },
      { path: 'live/:sessionId', element: <LiveSessionPage /> },
      { path: 'example/:sessionId', element: <SessionPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'files', element: <FilesPage /> },
      { path: 'rooms', element: <RoomsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export const router = createHashRouter(routes);
