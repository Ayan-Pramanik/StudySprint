'use client';
import { WorkspaceLink as Link } from './WorkspaceLink';
import type { ComponentProps } from 'react';
import { notePath } from '../lib/routes';

type Props = Omit<ComponentProps<typeof Link>, 'href'> & { id: string; onOpen?: () => void };
/** Native modified clicks open a new tab without changing the current workspace view. */
export function NoteLink({ id, onOpen, onNavigate, className = '', ...props }: Props) {
    return <Link {...props} href={notePath(id)} className={'route-link ' + className}
        onNavigate={() => { onNavigate?.(); onOpen?.(); }} />;
}
