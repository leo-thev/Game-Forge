import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";

export function Button({ children, variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

export function IconButton({ children, label, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function Heading({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Field({ label, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className={`field ${className}`}><span>{label}</span><input {...props} /></label>;
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><h2>{title}</h2><IconButton label="Close dialog" onClick={onClose}><X size={17} /></IconButton></header>{children}</section></div>;
}

export function SearchBox({ value, onChange, placeholder = "Search..." }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="search-box"><span className="sr-only">Search</span><span className="search-symbol">⌕</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}
