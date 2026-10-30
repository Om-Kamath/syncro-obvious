import { Router, type Request, type Response } from 'express';
import { parseProjectPayload } from './projectState';
import type { ProjectsStore } from './projects.store';

function notFound(res: Response, id: string): void {
  res.status(404).json({ error: `Project not found: ${id}` });
}

/**
 * REST CRUD for saved projects, mounted at `/api/projects`.
 * Validation failures throw ValidationError (status 400) and are rendered as
 * JSON by the app-level error handler.
 */
export function projectsRouter(store: ProjectsStore): Router {
  const router = Router();

  router.post('/', (req: Request, res: Response) => {
    const { name, state } = parseProjectPayload(req.body);
    const project = store.create(name, state);
    res.status(201).location(`/api/projects/${project.id}`).json(project);
  });

  router.get('/', (_req: Request, res: Response) => {
    res.json(store.list());
  });

  router.get('/:id', (req: Request, res: Response) => {
    const project = store.get(req.params.id);
    if (!project) {
      notFound(res, req.params.id);
      return;
    }
    res.json(project);
  });

  router.put('/:id', (req: Request, res: Response) => {
    const { name, state } = parseProjectPayload(req.body);
    const project = store.update(req.params.id, name, state);
    if (!project) {
      notFound(res, req.params.id);
      return;
    }
    res.json(project);
  });

  router.delete('/:id', (req: Request, res: Response) => {
    if (!store.delete(req.params.id)) {
      notFound(res, req.params.id);
      return;
    }
    res.status(204).send();
  });

  return router;
}
