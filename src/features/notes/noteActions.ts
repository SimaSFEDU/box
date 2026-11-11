import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { AppError } from '../../core/errors';
import { importAttachment } from '../../data/files/attachments';
import type { NoteDetail } from '../../data/repositories/notesRepo';
import { noteFileName } from '../../domain/notes/exportPaths';
import { notesRepo } from './notesService';

/** Lets the user pick an image and stores it as a note attachment. Returns its relative path or null if cancelled. */
export async function pickImageAttachment(noteId: string): Promise<{ relPath: string; name: string } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['image/*'], copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets[0]) return null;
  const asset = res.assets[0];
  const src = new File(asset.uri);
  try {
    const { relPath } = await importAttachment(notesRepo(), src, {
      itemId: noteId,
      originalName: asset.name,
      mime: asset.mimeType ?? 'application/octet-stream',
    });
    return { relPath, name: asset.name.replace(/\.[^.]+$/, '') };
  } finally {
    if (src.exists) src.delete(); // picker cache copy
  }
}

/** Shares a single note as a .md file through the Android share sheet; temp file removed afterwards. */
export async function shareNoteAsMarkdown(note: Pick<NoteDetail, 'title' | 'body'>): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new AppError('UNKNOWN', 'Отправка недоступна на этом устройстве');
  const file = new File(Paths.cache, noteFileName(note.title, note.body, new Set()));
  try {
    if (file.exists) file.delete();
    file.create();
    await file.write(note.body);
    await Sharing.shareAsync(file.uri, { mimeType: 'text/markdown', dialogTitle: 'Экспорт заметки' });
  } finally {
    if (file.exists) file.delete();
  }
}
