import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';

let cachedDisplayTransition: boolean | undefined;

function canTransitionDisplay(): boolean {
  if (cachedDisplayTransition !== undefined) return cachedDisplayTransition;
  if (
    typeof window === 'undefined' ||
    !window.CSS?.supports?.('transition-behavior', 'allow-discrete') ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  cachedDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return cachedDisplayTransition;
}

function supportsTopLayerExit(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.CSS?.supports?.('overlay', 'auto')) &&
    canTransitionDisplay()
  );
}

export async function closeTopLayerDialog(dialog: HTMLDialogElement): Promise<void> {
  if (!dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute('data-closing', '');
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => window.setTimeout(r, 350)),
      ]);
    }
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
  }
  if (dialog.open) {
    dialog.close();
  }
}

const DialogCloseContext = createContext<(() => void) | null>(null);

export function useDialogClose(fallbackClose: () => void): () => void {
  const ctx = useContext(DialogCloseContext);
  return ctx ?? fallbackClose;
}

interface ModalDialogProps {
  onClose: () => void;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  maxWidthClass?: string;
  maxWidthCss?: string;
  borderClass?: string;
  className?: string;
  children: ReactNode | ((requestClose: () => void) => ReactNode);
}

export function ModalDialog({
  onClose,
  ariaLabelledBy,
  ariaLabel,
  maxWidthCss = '32rem',
  borderClass = 'border border-white/[0.1]',
  className = '',
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      onCloseRef.current();
      return;
    }
    void closeTopLayerDialog(dialog);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!dialog.open) {
      dialog.showModal();
    }

    const handleClose = () => {
      dialog.returnValue = '';
      onCloseRef.current();
    };

    const handleCancel = (event: Event) => {
      if (!supportsTopLayerExit()) {
        event.preventDefault();
        void closeTopLayerDialog(dialog);
      }
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('cancel', handleCancel);

    // Fallback for browsers without native `closedby="any"` light-dismiss
    let cleanupLightDismiss: (() => void) | undefined;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) {
          void closeTopLayerDialog(dialog);
        }
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
      cleanupLightDismiss = () => {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('pointerup', onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('cancel', handleCancel);
      cleanupLightDismiss?.();
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <DialogCloseContext.Provider value={requestClose}>
      <dialog
        ref={dialogRef}
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        style={{ '--sb-dialog-max-w': maxWidthCss } as CSSProperties}
        className={`sb-dialog ${borderClass} ${className}`}
        {...({ closedby: 'any' } as Record<string, string>)}
      >
        {typeof children === 'function' ? children(requestClose) : children}
      </dialog>
    </DialogCloseContext.Provider>
  );
}
