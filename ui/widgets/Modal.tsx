// A dialog over the page: Escape, the close button and a tap outside close it.
// For a plain yes/no question use confirmDialog() instead.
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components';
import { useT } from '../hooks';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  id?: string;
}

export function Modal({ open, title, onClose, children, wide = false, id }: ModalProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);
  if (!open) return null;
  return createPortal(
    <dialog
      ref={ref}
      id={id}
      className={`modal${wide ? ' modal-wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" data-close aria-label={t('common.close')} onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>,
    document.body,
  );
}
