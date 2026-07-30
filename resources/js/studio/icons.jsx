import {
    Box, ChartColumn, ChevronRight, CircleHelp, ClipboardPaste, Copy, CopyPlus, Download,
    Folder, Globe, Grid2x2, Link2, LogOut, MapPin, MonitorCog, MousePointer2, Move, Pencil,
    Play, Plus, Redo2, RotateCw, Save, Scaling, Square, Trash2, Undo2, UserX, Users, Zap,
} from 'lucide-react';
import React from 'react';

const TOOL = { size: 22, strokeWidth: 1.8 };
const SMALL = { size: 16, strokeWidth: 1.8 };
const TREE = { size: 14, strokeWidth: 1.8 };

export const SelectIcon = () => <MousePointer2 {...TOOL} />;

export const MoveIcon = () => <Move {...TOOL} />;

export const RotateIcon = () => <RotateCw {...TOOL} />;

export const ScaleIcon = () => <Scaling {...TOOL} />;

export const PartIcon = () => <Box {...TOOL} />;

export const SpawnIcon = () => <MapPin {...TOOL} />;

export const CopyIcon = () => <Copy {...TOOL} />;

export const PasteIcon = () => <ClipboardPaste {...TOOL} />;

export const DuplicateIcon = () => <CopyPlus {...TOOL} />;

export const SaveIcon = () => <Save {...TOOL} />;

export const StatsIcon = () => <ChartColumn {...TOOL} />;

export const HelpIcon = () => <CircleHelp {...TOOL} />;

export const DownloadIcon = () => <Download {...TOOL} />;

export const UndoIcon = () => <Undo2 {...TOOL} />;

export const RedoIcon = () => <Redo2 {...TOOL} />;

export const DeleteIcon = () => <Trash2 {...TOOL} />;

export const StudsIcon = () => <Grid2x2 {...SMALL} />;

export const PlayIcon = () => <Play {...SMALL} fill="currentColor" />;

export const StopIcon = () => <Square {...SMALL} fill="currentColor" />;

export const PlusIcon = () => <Plus {...SMALL} />;

export const PencilIcon = () => <Pencil {...SMALL} />;

export const TrashIcon = () => <Trash2 {...SMALL} />;

export const TeamIcon = () => <Users {...TOOL} />;

export const LinkIcon = () => <Link2 {...SMALL} />;

export const LeaveIcon = () => <LogOut {...SMALL} />;

export const KickIcon = () => <UserX {...SMALL} />;

export const GraphicsIcon = () => <MonitorCog strokeWidth={1.8} />;

export const WorkspaceIcon = () => <Globe {...TREE} color="#4a9edb" />;

export const LightingIcon = () => <Zap {...TREE} color="#e8c832" fill="#e8c832" />;

export const FolderIcon = () => <Folder size={14} strokeWidth={2} color="#d9b45b" fill="#d9b45b" />;

export const ChevronIcon = () => <ChevronRight strokeWidth={2.4} />;

export const cubeIcon = (color) => <Box {...TREE} color={color} />;
