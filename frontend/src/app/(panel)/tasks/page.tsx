"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/I18nContext";
import { dateInputToISO, isoToDateInput } from "@/lib/api";
import { fmtLocale } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const token = () => (typeof window !== "undefined" ? localStorage.getItem("token") || "" : "");

type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type Status   = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

interface Task {
    id: string;
    title: string;
    description?: string;
    status: Status;
    priority: Priority;
    dueDate?: string;
    completedAt?: string;
    linkedClientId?: string;
    linkedPropertyId?: string;
    linkedTransactionId?: string;
    createdAt: string;
}

const PRIORITY_COLORS: Record<Priority, { color: string; bg: string }> = {
    URGENT: { color: "text-red-500",      bg: "bg-red-500/10 border-red-500/30" },
    HIGH:   { color: "text-amber-500",    bg: "bg-amber-500/10 border-amber-500/30" },
    MEDIUM: { color: "text-primary",      bg: "bg-primary/10 border-primary/30" },
    LOW:    { color: "text-foreground/40", bg: "bg-foreground/5 border-border" },
};

const INPUT_CLS = "px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:border-primary outline-none transition-colors";
const SELECT_CLS = "px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:border-primary outline-none cursor-pointer";

export default function TasksPage() {
    const toast = useToast();
    const { t } = useI18n();
    const T = (t as any).tasks ?? {};

    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("all");
    const [showForm, setShowForm] = useState(false);
    const [editTask, setEditTask] = useState<Task | null>(null);
    const [filterPriority, setFilterPriority] = useState("all");

    // Form state
    const [form, setForm] = useState({
        title: "", description: "", priority: "MEDIUM" as Priority, dueDate: "",
    });

    const fetchTasks = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API}/api/tasks`, {
                headers: { Authorization: `Bearer ${token()}` },
            });
            if (res.ok) setTasks(await res.json());
        } catch { toast.error(T.toastLoadError); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchTasks(); }, [fetchTasks]);

    const openNew = () => {
        setEditTask(null);
        setForm({ title: "", description: "", priority: "MEDIUM", dueDate: "" });
        setShowForm(true);
    };

    const openEdit = (task: Task) => {
        setEditTask(task);
        setForm({
            title:       task.title,
            description: task.description || "",
            priority:    task.priority,
            dueDate:     isoToDateInput(task.dueDate),
        });
        setShowForm(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.title.trim()) return;
        try {
            const method = editTask ? "PATCH" : "POST";
            const url    = editTask ? `${API}/api/tasks/${editTask.id}` : `${API}/api/tasks`;
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
                body: JSON.stringify({ ...form, dueDate: dateInputToISO(form.dueDate, true) }),
            });
            if (res.ok) {
                toast.success(editTask ? T.toastUpdated : T.toastCreated);
                setShowForm(false);
                fetchTasks();
            } else {
                toast.error(T.toastError);
            }
        } catch { toast.error(T.toastNetwork); }
    };

    const setStatus = async (task: Task, status: Status) => {
        try {
            const res = await fetch(`${API}/api/tasks/${task.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
                body: JSON.stringify({ status }),
            });
            if (res.ok) {
                setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t));
                if (status === "COMPLETED") toast.success(T.toastCompleted);
            }
        } catch { toast.error(T.toastNetwork); }
    };

    const deleteTask = async (id: string) => {
        try {
            const res = await fetch(`${API}/api/tasks/${id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token()}` },
            });
            if (res.ok) {
                setTasks(prev => prev.filter(t => t.id !== id));
                toast.success(T.toastDeleted);
            }
        } catch { toast.error(T.toastDeleteError); }
    };

    const isOverdue = (task: Task) =>
        task.dueDate && task.status !== "COMPLETED" && new Date(task.dueDate) < new Date();

    const priorityLabel = (p: Priority) => {
        const map: Record<Priority, string> = {
            URGENT: T.priorityUrgent,
            HIGH:   T.priorityHigh,
            MEDIUM: T.priorityMedium,
            LOW:    T.priorityLow,
        };
        return map[p];
    };

    const STATUS_TABS = [
        { key: "all",         label: T.all },
        { key: "PENDING",     label: T.toDo },
        { key: "IN_PROGRESS", label: T.inProgress },
        { key: "COMPLETED",   label: T.completed },
    ];

    const filtered = tasks.filter(t => {
        const matchTab = activeTab === "all" || t.status === activeTab;
        const matchPri = filterPriority === "all" || t.priority === filterPriority;
        return matchTab && matchPri;
    });

    const counts = {
        pending:    tasks.filter(t => t.status === "PENDING").length,
        inProgress: tasks.filter(t => t.status === "IN_PROGRESS").length,
        overdue:    tasks.filter(t => isOverdue(t)).length,
        completed:  tasks.filter(t => t.status === "COMPLETED").length,
    };

    return (
        <div className="max-w-4xl mx-auto">
            {/* Page header */}
            <div className="flex items-start justify-between mb-6 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">{T.title}</h1>
                    <p className="text-sm text-foreground/50 mt-0.5">{T.subtitle}</p>
                </div>
                <button
                    onClick={openNew}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-background rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex-shrink-0"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    {T.newTask}
                </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {[
                    { label: T.toDo,       value: counts.pending,    color: "text-foreground" },
                    { label: T.inProgress, value: counts.inProgress, color: "text-primary" },
                    { label: T.overdue,    value: counts.overdue,    color: "text-red-500" },
                    { label: T.completed,  value: counts.completed,  color: "text-green-500" },
                ].map(card => (
                    <div key={card.label} className="bg-surface border border-border rounded-xl p-4">
                        <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
                        <div className="text-xs text-foreground/50 mt-0.5">{card.label}</div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                {/* Status tabs */}
                <div className="flex bg-surface border border-border rounded-lg p-0.5 gap-0.5">
                    {STATUS_TABS.map(tab => (
                        <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                activeTab === tab.key ? "bg-primary text-background" : "text-foreground/50 hover:text-foreground"
                            }`}>
                            {tab.label}
                        </button>
                    ))}
                </div>
                {/* Priority filter */}
                <select className={SELECT_CLS} value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
                    <option value="all">{T.allPriorities}</option>
                    {(["URGENT","HIGH","MEDIUM","LOW"] as Priority[]).map(p => (
                        <option key={p} value={p}>{priorityLabel(p)}</option>
                    ))}
                </select>
            </div>

            {/* Task list */}
            {loading ? (
                <div className="flex items-center justify-center py-16 text-foreground/40 gap-3">
                    <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin" />
                    {T.loading}
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-foreground/40">
                    <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    <p className="text-sm">{T.noTasks}</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {filtered.map(task => {
                        const overdue = isOverdue(task);
                        const pcfg = PRIORITY_COLORS[task.priority];
                        return (
                            <div key={task.id}
                                className={`bg-surface border rounded-xl p-4 transition-all hover:shadow-sm ${
                                    overdue ? "border-red-500/30" : "border-border"
                                } ${task.status === "COMPLETED" ? "opacity-60" : ""}`}>
                                <div className="flex items-start gap-3">
                                    {/* Checkbox */}
                                    <button
                                        onClick={() => setStatus(task, task.status === "COMPLETED" ? "PENDING" : "COMPLETED")}
                                        className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                            task.status === "COMPLETED"
                                                ? "bg-green-500 border-green-500"
                                                : "border-border hover:border-primary"
                                        }`}
                                    >
                                        {task.status === "COMPLETED" && (
                                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                        )}
                                    </button>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2 flex-wrap">
                                            <span className={`text-sm font-medium ${task.status === "COMPLETED" ? "line-through text-foreground/40" : "text-foreground"}`}>
                                                {task.title}
                                            </span>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {/* Priority badge */}
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${pcfg.bg} ${pcfg.color}`}>
                                                    {priorityLabel(task.priority)}
                                                </span>
                                                {/* Status badge */}
                                                {task.status === "IN_PROGRESS" && (
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 border border-primary/30 text-primary">
                                                        {T.inProgressBadge}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {task.description && (
                                            <p className="text-xs text-foreground/50 mt-1 leading-relaxed">{task.description}</p>
                                        )}

                                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                                            {task.dueDate && (
                                                <span className={`text-xs flex items-center gap-1 ${overdue ? "text-red-500 font-medium" : "text-foreground/40"}`}>
                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                    {overdue ? `${T.overdueLabel} · ` : `${T.dueLabel} `}
                                                    {new Date(task.dueDate).toLocaleDateString(fmtLocale())}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        {task.status !== "COMPLETED" && (
                                            <button
                                                onClick={() => setStatus(task, task.status === "PENDING" ? "IN_PROGRESS" : "PENDING")}
                                                className="p-1.5 text-foreground/30 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                                                title={task.status === "PENDING" ? "Start" : "Pause"}
                                            >
                                                {task.status === "PENDING"
                                                    ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                }
                                            </button>
                                        )}
                                        <button onClick={() => openEdit(task)}
                                            className="p-1.5 text-foreground/30 hover:text-foreground hover:bg-surface-hover rounded-lg transition-colors">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                        </button>
                                        <button onClick={() => deleteTask(task.id)}
                                            className="p-1.5 text-foreground/30 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Create / Edit modal */}
            {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200">
                    <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
                            <h2 className="text-base font-semibold text-foreground">
                                {editTask ? T.modal?.editTitle : T.modal?.newTitle}
                            </h2>
                            <button onClick={() => setShowForm(false)} className="p-1.5 text-foreground/40 hover:text-foreground rounded-lg transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-foreground/60 mb-1.5 uppercase tracking-widest">
                                    {T.modal?.taskTitle}
                                </label>
                                <input className={`${INPUT_CLS} w-full`} value={form.title}
                                    onChange={e => setForm({ ...form, title: e.target.value })}
                                    placeholder={T.modal?.placeholder}
                                    required autoFocus />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-foreground/60 mb-1.5 uppercase tracking-widest">
                                    {T.modal?.description}
                                </label>
                                <textarea className={`${INPUT_CLS} w-full resize-none`} rows={3}
                                    value={form.description}
                                    onChange={e => setForm({ ...form, description: e.target.value })}
                                    placeholder={T.modal?.descPlaceholder} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-foreground/60 mb-1.5 uppercase tracking-widest">
                                        {T.modal?.priority}
                                    </label>
                                    <select className={`${SELECT_CLS} w-full`} value={form.priority}
                                        onChange={e => setForm({ ...form, priority: e.target.value as Priority })}>
                                        {(["URGENT","HIGH","MEDIUM","LOW"] as Priority[]).map(p => (
                                            <option key={p} value={p}>{priorityLabel(p)}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-foreground/60 mb-1.5 uppercase tracking-widest">
                                        {T.modal?.dueDate}
                                    </label>
                                    <input className={`${INPUT_CLS} w-full`} type="date" value={form.dueDate}
                                        onChange={e => setForm({ ...form, dueDate: e.target.value })} />
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowForm(false)}
                                    className="flex-1 py-2.5 border border-border rounded-lg text-sm text-foreground/60 hover:bg-surface-hover transition-colors">
                                    {T.modal?.cancel}
                                </button>
                                <button type="submit"
                                    className="flex-1 py-2.5 bg-primary text-background rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                                    {editTask ? T.modal?.saveChanges : T.modal?.save}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
