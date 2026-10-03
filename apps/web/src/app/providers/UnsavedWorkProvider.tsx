import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useBlocker } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ui';

/**
 * Guards unsaved work.
 *
 * `docs/01-REQUIREMENTS.md` `REQ-RESP-008` and `REQ-RESP-009` require confirmation before a
 * navigation or sign-out could discard what the Admin has typed. `docs/03-UI-UX-RULES.md` phrases
 * the same obligation for navigation and logout.
 *
 * A form registers itself with `useUnsavedWork(isDirty)`. While any form is dirty this provider:
 *
 * - blocks an in-app route change with React Router's `useBlocker` and shows a confirmation dialog;
 * - registers a `beforeunload` listener so closing or reloading the tab asks the browser's own
 *   confirmation, which is the only honest way to intercept a navigation the browser owns;
 * - exposes `requestConfirmation` so a control that is *not* a route change — sign-out — can ask
 *   before it acts, instead of ending the session and then discovering the work was unsaved.
 *
 * It is mounted inside the route tree (in the application shell) because `useBlocker` needs the
 * data-router context. The sign-in screen has no unsaved form and is outside this provider.
 */
interface UnsavedWorkContextValue {
  readonly isDirty: boolean;
  readonly setDirty: (id: string, dirty: boolean) => void;
  readonly requestConfirmation: (request: ConfirmationRequest) => Promise<boolean>;
}

interface ConfirmationRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string | undefined;
  readonly tone?: 'danger' | 'primary' | undefined;
}

const UnsavedWorkContext = createContext<UnsavedWorkContextValue | null>(null);

/**
 * Registers the calling form as dirty or clean for as long as it is mounted.
 *
 * The effect re-runs whenever `isDirty` changes, so a form that saves and clears its input stops
 * blocking navigation immediately. The cleanup reports clean, so an unmounted form can never leave
 * a stale registration behind.
 */
export function useUnsavedWork(isDirty: boolean): void {
  const context = useContext(UnsavedWorkContext);
  const setDirty = context?.setDirty;
  const id = useId();

  useEffect(() => {
    if (setDirty === undefined) {
      return undefined;
    }

    setDirty(id, isDirty);
    return () => {
      setDirty(id, false);
    };
  }, [setDirty, id, isDirty]);
}

export function useUnsavedWorkStatus(): UnsavedWorkContextValue {
  const context = useContext(UnsavedWorkContext);
  if (context === null) {
    throw new Error('useUnsavedWorkStatus must be used within an UnsavedWorkProvider.');
  }

  return context;
}

export function UnsavedWorkProvider({ children }: { readonly children: ReactNode }) {
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [pending, setPending] = useState<{
    readonly request: ConfirmationRequest;
    readonly resolve: (confirmed: boolean) => void;
  } | null>(null);

  const setDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((previous) => {
      if (previous.has(id) === dirty) {
        return previous;
      }

      const next = new Set(previous);
      if (dirty) {
        next.add(id);
      } else {
        next.delete(id);
      }

      return next;
    });
  }, []);

  const isDirty = dirtyIds.size > 0;

  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        isDirty && currentLocation.pathname !== nextLocation.pathname,
      [isDirty],
    ),
  );

  useEffect(() => {
    if (!isDirty) {
      return undefined;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      // Some browsers require `returnValue` to be set even though the message is ignored.
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty]);

  const requestConfirmation = useCallback(
    (request: ConfirmationRequest) =>
      new Promise<boolean>((resolve) => {
        setPending({ request, resolve });
      }),
    [],
  );

  function settle(result: boolean): void {
    setPending((current) => {
      current?.resolve(result);
      return null;
    });
  }

  const value = useMemo<UnsavedWorkContextValue>(
    () => ({ isDirty, setDirty, requestConfirmation }),
    [isDirty, setDirty, requestConfirmation],
  );

  const blocked = blocker.state === 'blocked' ? blocker : null;

  return (
    <UnsavedWorkContext.Provider value={value}>
      {children}

      {blocked === null ? null : (
        <ConfirmDialog
          title="Leave with unsaved changes?"
          message="You have unsaved changes on this page. Leaving now will discard them."
          confirmLabel="Leave and discard"
          cancelLabel="Keep editing"
          tone="danger"
          onConfirm={() => {
            blocked.proceed();
          }}
          onCancel={() => {
            blocked.reset();
          }}
        />
      )}

      {pending === null ? null : (
        <ConfirmDialog
          title={pending.request.title}
          message={pending.request.message}
          confirmLabel={pending.request.confirmLabel}
          cancelLabel={pending.request.cancelLabel ?? 'Keep editing'}
          tone={pending.request.tone ?? 'danger'}
          onConfirm={() => {
            settle(true);
          }}
          onCancel={() => {
            settle(false);
          }}
        />
      )}
    </UnsavedWorkContext.Provider>
  );
}
