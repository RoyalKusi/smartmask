import {
  Button,
  Toast,
  ToastBody,
  ToastFooter,
  ToastTitle,
  Toaster,
  useToastController,
} from '@fluentui/react-components';
import { useEffect } from 'react';
import type { NotifyOptions } from './notifyTypes';

const TOASTER_ID = 'sm-toaster';

export default function ToasterHost({ onReady }: { onReady: (fn: (o: NotifyOptions) => void) => void }) {
  const { dispatchToast, dismissToast } = useToastController(TOASTER_ID);
  useEffect(() => {
    onReady((o) => {
      const id = `t-${Math.random().toString(36).slice(2)}`;
      dispatchToast(
        <Toast
          className="sm-acrylic"
          style={{ boxShadow: 'var(--sm-shadow16)', borderRadius: 'var(--sm-r-card)' }}
        >
          <ToastTitle>{o.title}</ToastTitle>
          {o.body && <ToastBody>{o.body}</ToastBody>}
          {o.undo && (
            <ToastFooter>
              <Button
                size="small"
                appearance="primary"
                onClick={() => {
                  o.undo?.();
                  dismissToast(id);
                }}
              >
                Undo
              </Button>
            </ToastFooter>
          )}
        </Toast>,
        {
          toastId: id,
          intent: o.intent ?? 'success',
          timeout: o.timeout ?? 5000,
          pauseOnHover: true,
          pauseOnWindowBlur: true,
          politeness: o.intent === 'error' ? 'assertive' : 'polite',
        },
      );
    });
    // Register once; dispatchToast and dismissToast are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Toaster toasterId={TOASTER_ID} position="top-end" limit={4} offset={{ vertical: 56, horizontal: 12 }} />
  );
}
