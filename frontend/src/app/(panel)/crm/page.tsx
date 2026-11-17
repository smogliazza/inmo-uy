"use client";

import React from "react";
import { formatPhoneUY } from "@/lib/catalogs";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useToast } from "@/components/ui/Toast";
import Link from "next/link";
import { useExtra, fmt } from "@/lib/i18n/extra";
import { api, ApiError } from "@/lib/api";
import { parseCsv, mapClientCsvRows, downloadCsvTemplate } from "@/lib/csv";
import { useSettings } from "@/lib/settings/useSettings";

const TEMP_STYLES: Record<string, string> = {
  HOT: "bg-red-500/10 text-red-500 border-red-500/30",
  WARM: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  COLD: "bg-sky-500/10 text-sky-600 border-sky-500/30",
};

function daysSince(d?: string | null) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

export default function CRMPage() {
  const { t } = useI18n();
  const X = useExtra();
  const toast = useToast();
  // Brokerage rules (Settings > CRM) and this person's preferences
  const { policies, preferences } = useSettings();
  const requiredFields = policies.crm.requiredFields;
  const isRequired = (field: string) => requiredFields.includes(field);
  const star = (field: string) => (isRequired(field) ? " *" : "");
  const showBudget = preferences.crm.showBudget;
  const cellPad = preferences.crm.compactList ? "px-6 py-2" : "px-6 py-4";

  const [clients, setClients] = React.useState<any[]>([]);
  const [totalClients, setTotalClients] = React.useState(0);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [accessDenied, setAccessDenied] = React.useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = React.useState(false);
  const [csvRows, setCsvRows] = React.useState<Record<string, string>[]>([]);
  const [onDuplicate, setOnDuplicate] = React.useState<"skip" | "update">("skip");
  const [isImporting, setIsImporting] = React.useState(false);
  const [formData, setFormData] = React.useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    type: "BUYER",
    budget: "",
    status: "LEAD",
    funnelStage: "LEAD",
    source: "",
    temperature: "WARM",
    tags: "",
  });
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterType, setFilterType] = React.useState("ALL");
  const [filterStatus, setFilterStatus] = React.useState("ALL");
  const [filterTemp, setFilterTemp] = React.useState("ALL");
  const [staleOnly, setStaleOnly] = React.useState(false);

  const fetchClients = React.useCallback((page = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "10" });
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (filterType !== "ALL") params.set("type", filterType);
    if (filterStatus !== "ALL") params.set("status", filterStatus);
    if (filterTemp !== "ALL") params.set("temperature", filterTemp);
    if (staleOnly) params.set("stale", "true");
    api(`/api/clients?${params}`)
      .then((data) => {
        setClients(data.data || []);
        setTotalClients(data.total || 0);
        setCurrentPage(data.page || 1);
      })
      .catch((err) => {
        // Role has no CRM access (e.g. attorney / lender / title co.) — stay logged in
        if (err instanceof ApiError && err.status === 403) setAccessDenied(err.message);
        else console.error(err);
      })
      .finally(() => setLoading(false));
  }, [searchQuery, filterType, filterStatus, filterTemp, staleOnly]);

  // Debounce search typing; filters apply immediately
  React.useEffect(() => {
    const id = setTimeout(() => fetchClients(1), 300);
    return () => clearTimeout(id);
  }, [fetchClients]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Filtering happens on the server, across every page
  const filteredClients = clients;

  // A blank form that starts from this person's preferred client type and stage
  const blankForm = () => ({
    firstName: "", lastName: "", email: "", phone: "", budget: "", status: "LEAD", source: "", temperature: "WARM", tags: "",
    type: preferences.crm.defaultClientType, funnelStage: preferences.crm.defaultFunnelStage,
  });
  const openAddModal = () => { setFormData(blankForm()); setIsAddModalOpen(true); };

  const handleAddClient = async (e: React.FormEvent, force = false) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/clients", { method: "POST", body: { ...formData, force } });
      setIsAddModalOpen(false);
      setFormData(blankForm());
      fetchClients(1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        if (window.confirm(fmt(X.crm.duplicateConfirm, { msg: err.message }))) {
          setIsSubmitting(false);
          return handleAddClient(e, true);
        }
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to add client. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (accessDenied) {
    return (
      <div className="p-16 text-center text-foreground">
        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <p className="text-sm text-foreground/60">{accessDenied}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out text-foreground">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 pb-6 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t.crm.title}
          </h1>
          <p className="text-foreground/50 mt-1 text-sm">
            {t.crm.subtitle}
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="px-4 py-2 bg-primary text-background hover:opacity-90 transition-opacity rounded-lg text-sm font-semibold shadow-sm w-full md:w-auto text-center"
        >
          {t.crm.addClient}
        </button>
      </div>

      <div className="bg-surface border border-border rounded-xl flex flex-col overflow-hidden">
        {/* CRM Toolbar */}
        <div className="p-4 border-b border-border flex flex-col md:flex-row gap-3 bg-background/50">
          <input
            type="text"
            placeholder={t.crm.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all placeholder:text-foreground/30"
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-2.5 bg-background border border-border/60 rounded-xl font-sans text-base text-foreground/80 outline-none cursor-pointer focus:border-primary focus:ring-1 focus:ring-primary transition-all shadow-sm appearance-none md:w-48"
          >
            <option value="ALL">{t.crm.filters.allTypes}</option>
            <option value="BUYER">{t.crm.modal.typeBuyer}</option>
            <option value="SELLER">{t.crm.modal.typeSeller}</option>
            <option value="REFERRAL">{t.crm.modal.typeReferral}</option>
            <option value="RENTER">{X.crm.typeRenter}</option>
            <option value="INVESTOR">{X.crm.typeInvestor}</option>
          </select>
          <select
            value={filterTemp}
            onChange={(e) => setFilterTemp(e.target.value)}
            className="px-4 py-2.5 bg-background border border-border/60 rounded-xl font-sans text-base text-foreground/80 outline-none cursor-pointer focus:border-primary focus:ring-1 focus:ring-primary transition-all shadow-sm appearance-none md:w-40"
          >
            <option value="ALL">{X.crm.allPriorities}</option>
            <option value="HOT">{X.crm.HOT}</option>
            <option value="WARM">{X.crm.WARM}</option>
            <option value="COLD">{X.crm.COLD}</option>
          </select>
          <label className="flex items-center gap-2 px-3 text-sm text-foreground/70 cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} className="accent-primary" />
            {X.crm.needsFollowUp}<button type="button" onClick={(e) => { e.preventDefault(); setCsvRows([]); setIsImportModalOpen(true); }} className="ml-2 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-semibold text-foreground hover:bg-background transition-colors">{X.leadRouting.csvImportBtn}</button>
          </label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2.5 bg-background border border-border/60 rounded-xl font-sans text-base text-foreground/80 outline-none cursor-pointer focus:border-primary focus:ring-1 focus:ring-primary transition-all shadow-sm appearance-none md:w-48"
          >
            <option value="ALL">{t.crm.filters.allStatuses}</option>
            <option value="ACTIVE">{t.crm.modal.statusActive}</option>
            <option value="LEAD">{t.crm.modal.statusLead}</option>
            <option value="IN_CONTRACT">{t.crm.modal.statusInContract}</option>
            <option value="CLOSED">{t.crm.modal.statusClosed}</option>
          </select>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto bg-background">
          <table className="w-full text-left text-base font-sans">
            <thead className="bg-surface/30 border-b border-border/40 text-foreground/60 text-sm font-semibold">
              <tr>
                <th className="px-6 py-4 font-semibold">
                  {t.crm.table.clientName}
                </th>
                <th className="px-6 py-4 font-semibold">{t.crm.table.type}</th>
                <th className="px-6 py-4 font-semibold">{t.crm.table.contact}</th>
                {showBudget && (
                  <th className="px-6 py-4 font-semibold">
                    {t.crm.table.searchBudget}
                  </th>
                )}
                <th className="px-6 py-4 font-semibold">{t.crm.table.status}</th>
                <th className="px-6 py-4 font-semibold">{X.crm.lastContact}</th>
                <th className="px-6 py-4 font-semibold text-right">
                  {t.crm.table.actions}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {loading ? (
                <tr>
                  <td
                    colSpan={showBudget ? 7 : 6}
                    className="px-6 py-12 text-center text-foreground/50 tracking-widest text-xs font-medium"
                  >
                    {t.crm.table.loading}
                  </td>
                </tr>
              ) : filteredClients.length === 0 ? (
                <tr>
                  <td
                    colSpan={showBudget ? 7 : 6}
                    className="px-6 py-12 text-center text-foreground/50 tracking-widest text-xs font-medium"
                  >
                    {t.crm.table.noClients}
                  </td>
                </tr>
              ) : (
                filteredClients.map((client) => (
                  <tr
                    key={client.id}
                    className="hover:bg-surface/40 transition-colors duration-200 group"
                  >
                    <td className={`${cellPad} font-medium text-foreground flex items-center gap-4`}>
                      <div className="w-10 h-10 rounded-full border border-border/60 bg-surface flex items-center justify-center text-primary text-sm font-semibold tracking-wide">
                        {client.firstName.charAt(0)}
                        {client.lastName.charAt(0)}
                      </div>
                      <span className="tracking-wide text-foreground">
                        {client.firstName} {client.lastName}
                      </span>
                      {client.temperature && (
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${TEMP_STYLES[client.temperature] || ""}`}>
                          {(X.crm as any)[client.temperature] || client.temperature}
                        </span>
                      )}
                    </td>
                    <td className={`${cellPad}`}>
                      <span className="text-sm font-semibold px-2.5 py-1 rounded-md bg-surface border border-border/40 text-foreground/70">
                        {client.type === "BUYER"
                          ? t.crm.modal.typeBuyer
                          : client.type === "SELLER"
                            ? t.crm.modal.typeSeller
                            : client.type === "RENTER"
                              ? X.crm.typeRenter
                              : client.type === "INVESTOR"
                                ? X.crm.typeInvestor
                                : t.crm.modal.typeReferral}
                      </span>
                    </td>
                    <td className={`${cellPad} text-foreground/60 tracking-wide font-medium`}>
                      {formatPhoneUY(client.phone) || "-"}
                    </td>
                    {showBudget && (
                      <td className={`${cellPad} text-foreground/80 font-medium tracking-wide`}>
                        {client.budget || "-"}
                      </td>
                    )}
                    <td className={`${cellPad}`}>
                      <span
                        className={`text-sm font-semibold flex items-center gap-2
                                                ${client.status === "ACTIVE" ? "text-primary" : ""}
                                                ${client.status === "IN_CONTRACT" ? "text-foreground/90" : ""}
                                                ${client.status === "LEAD" ? "text-foreground/50" : ""}
                                                ${client.status === "CLOSED" ? "text-foreground/30" : ""}
                                            `}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full 
                                                    ${client.status === "ACTIVE" ? "bg-primary" : "bg-border"}
                                                    ${client.status === "IN_CONTRACT" ? "bg-foreground" : ""}
                                                `}
                        />
                        {client.status === "IN_CONTRACT"
                          ? t.crm.modal.statusInContract
                          : client.status === "ACTIVE"
                            ? t.crm.modal.statusActive
                            : client.status === "LEAD"
                              ? t.crm.modal.statusLead
                              : t.crm.modal.statusClosed}
                      </span>
                    </td>
                    <td className={`${cellPad} text-sm`}>
                      {(() => {
                        const d = daysSince(client.lastContactedAt);
                        const stale = d === null || d >= 14;
                        return (
                          <span className={stale ? "text-red-500 font-medium" : "text-foreground/60"}>
                            {d === null ? X.crm.never : d === 0 ? X.crm.today : fmt(X.crm.daysAgo, { n: d })}
                          </span>
                        );
                      })()}
                    </td>
                    <td className={`${cellPad} text-right`}>
                      <Link
                        href={`/crm/${client.id}`}
                        className="text-primary hover:text-primary-hover font-sans text-base font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      >
                        {t.crm.table.viewProfile} &rarr;
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-6 border-t border-border flex items-center justify-between text-sm tracking-widest uppercase text-foreground/50 bg-surface/30">
          <span>
            {t.crm.pagination.showing}{" "}
            <span className="text-foreground font-serif">
              {filteredClients.length}
            </span>{" "}
            {t.crm.pagination.of}{" "}
            <span className="text-foreground font-serif">{totalClients}</span>{" "}
            {t.crm.pagination.clients}
          </span>
          <div className="flex gap-4">
            <button
              disabled={currentPage === 1 || loading}
              onClick={() => fetchClients(currentPage - 1)}
              className="hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-foreground/50"
            >
              &larr; {t.crm.pagination.previous}
            </button>
            <button
              disabled={currentPage * 10 >= totalClients || loading}
              onClick={() => fetchClients(currentPage + 1)}
              className="hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-foreground/50"
            >
              {t.crm.pagination.next} &rarr;
            </button>
          </div>
        </div>
      </div>

      {/* Add Client Modal Overlay */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-300 p-4">
          <div className="bg-background ring-1 ring-border/50 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] rounded-3xl">
            <div className="p-8 border-b border-border/40 flex justify-between items-center bg-surface/30">
              <h2 className="font-sans text-2xl font-semibold text-foreground">
                {t.crm.modal.title}
              </h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-foreground/40 hover:text-foreground text-3xl font-light transition-colors leading-none"
              >
                &times;
              </button>
            </div>
            <form
              onSubmit={(e) => handleAddClient(e)}
              className="p-8 overflow-y-auto space-y-6"
            >
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {t.crm.modal.firstName}
                  </label>
                  <input
                    required
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    type="text"
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-foreground/30 shadow-sm"
                    placeholder="John"
                  />
                </div>
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {t.crm.modal.lastName}
                  </label>
                  <input
                    required
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    type="text"
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-foreground/30 shadow-sm"
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div>
                <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                  {t.crm.modal.email}{star("email")}
                </label>
                <input
                  required={isRequired("email")}
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  type="email"
                  className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-foreground/30 shadow-sm"
                  placeholder="john@example.com"
                />
              </div>

              <div>
                <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                  {t.crm.modal.phone}{star("phone")}
                </label>
                <input
                  required={isRequired("phone")}
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  type="tel"
                  className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-foreground/30 shadow-sm"
                  placeholder="+1 (555) 000-0000"
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {t.crm.modal.type}
                  </label>
                  <select
                    name="type"
                    value={formData.type}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all appearance-none cursor-pointer shadow-sm"
                  >
                    <option value="BUYER">{t.crm.modal.typeBuyer}</option>
                    <option value="SELLER">{t.crm.modal.typeSeller}</option>
                    <option value="REFERRAL">{t.crm.modal.typeReferral}</option>
                    <option value="RENTER">{X.crm.typeRenter}</option>
                    <option value="INVESTOR">{X.crm.typeInvestor}</option>
                  </select>
                </div>
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {t.crm.modal.status}
                  </label>
                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all appearance-none cursor-pointer shadow-sm"
                  >
                    <option value="LEAD">{t.crm.modal.statusLead}</option>
                    <option value="ACTIVE">{t.crm.modal.statusActive}</option>
                    <option value="IN_CONTRACT">
                      {t.crm.modal.statusInContract}
                    </option>
                    <option value="CLOSED">{t.crm.modal.statusClosed}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                  {t.crm.modal.budget}{star("budget")}
                </label>
                <input
                  required={isRequired("budget")}
                  name="budget"
                  value={formData.budget}
                  onChange={handleChange}
                  type="text"
                  className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-foreground/30 shadow-sm"
                  placeholder="e.g. $1.2M - $1.5M"
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">{X.crm.source}{star("source")}</label>
                  <input
                    required={isRequired("source")}
                    name="source"
                    value={formData.source}
                    onChange={handleChange}
                    list="lead-sources"
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-foreground/30 shadow-sm"
                    placeholder={X.crm.sourcePlaceholder}
                  />
                  <datalist id="lead-sources">
                    {policies.crm.leadSources.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">{X.crm.priority}</label>
                  <select
                    name="temperature"
                    value={formData.temperature}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all appearance-none cursor-pointer shadow-sm"
                  >
                    <option value="HOT">{X.crm.HOT}</option>
                    <option value="WARM">{X.crm.WARM}</option>
                    <option value="COLD">{X.crm.COLD}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">{X.crm.tags}</label>
                <input
                  name="tags"
                  value={formData.tags}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-foreground/30 shadow-sm"
                  placeholder={X.crm.tagsPlaceholder}
                />
              </div>

              <div className="pt-6 flex justify-end gap-3 mt-8 border-t border-border/40">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-6 py-2.5 bg-surface border border-border/60 text-foreground/70 rounded-xl text-base font-semibold hover:text-foreground transition-colors shadow-sm"
                >
                  {t.crm.modal.cancel}
                </button>
                <button
                  disabled={isSubmitting}
                  type="submit"
                  className="px-6 py-2.5 bg-primary text-background rounded-xl text-base font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-md"
                >
                  {isSubmitting ? t.crm.modal.saving : t.crm.modal.save}
                </button></div></form></div></div>)}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-2xl p-6 shadow-2xl relative space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h2 className="text-xl font-bold text-foreground">{X.leadRouting.csvModalTitleClients}</h2>
                <p className="text-xs text-foreground/50 mt-1">{X.leadRouting.csvModalDesc}</p>
              </div>
              <button onClick={() => setIsImportModalOpen(false)} className="text-foreground/40 hover:text-foreground">✕</button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="px-4 py-2 bg-primary text-background rounded-lg text-sm font-semibold cursor-pointer hover:opacity-90">
                {X.leadRouting.csvSelectFile}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    setCsvRows(mapClientCsvRows(parseCsv(text)));
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => downloadCsvTemplate("clients-template.csv", "firstName,lastName,email,phone,type,temperature,budget,source,tags\nAlex,Rivera,alex@example.com,+1-212-555-0142,BUYER,HOT,$1.5M,Open House,Pre-approved")}
                className="px-3 py-1.5 bg-background border border-border rounded-lg text-xs text-foreground/70 hover:text-foreground"
              >
                {X.leadRouting.csvDownloadTemplate}
              </button>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-foreground/60 text-xs">{X.leadRouting.csvOnDuplicateLabel}</span>
              <select value={onDuplicate} onChange={(e) => setOnDuplicate(e.target.value as any)} className="px-3 py-1.5 bg-background border border-border rounded-lg text-xs text-foreground">
                <option value="skip">{X.leadRouting.csvSkipDuplicates}</option>
                <option value="update">{X.leadRouting.csvUpdateDuplicates}</option>
              </select>
            </div>
            {csvRows.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="bg-background px-3 py-2 text-xs font-semibold text-foreground/60 border-b border-border">
                  {fmt(X.leadRouting.csvPreviewTitle, { n: csvRows.length })}
                </div>
                <div className="max-h-48 overflow-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-surface border-b border-border text-foreground/50">
                      <tr>
                        <th className="p-2">Name</th>
                        <th className="p-2">Email</th>
                        <th className="p-2">Phone</th>
                        <th className="p-2">Type</th>
                        <th className="p-2">Budget</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-b border-border/40 last:border-0">
                          <td className="p-2 text-foreground">{r.fullName || `${r.firstName || ""} ${r.lastName || ""}`.trim()}</td>
                          <td className="p-2 text-foreground/70">{r.email || "—"}</td>
                          <td className="p-2 text-foreground/70">{r.phone || "—"}</td>
                          <td className="p-2 text-foreground/70">{r.type || "BUYER"}</td>
                          <td className="p-2 text-foreground/70">{r.budget || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-3 border-t border-border">
              <button type="button" onClick={() => setIsImportModalOpen(false)} className="px-4 py-2 bg-background border border-border rounded-lg text-sm text-foreground/70">
                {t.crm.modal.cancel}
              </button>
              <button
                type="button"
                disabled={csvRows.length === 0 || isImporting}
                onClick={async () => {
                  setIsImporting(true);
                  try {
                    const res = await api("/api/clients/import", { method: "POST", body: { rows: csvRows, onDuplicate } });
                    toast.success(fmt(X.leadRouting.csvResultSummary, { created: res.created, updated: res.updated, skipped: res.skipped }));
                    setIsImportModalOpen(false);
                    setCsvRows([]);
                    fetchClients(1);
                  } catch (err: any) {
                    toast.error(err?.message || X.common.error);
                  } finally {
                    setIsImporting(false);
                  }
                }}
                className="px-4 py-2 bg-primary text-background rounded-lg text-sm font-semibold disabled:opacity-40"
              >
                {isImporting ? X.leadRouting.csvImporting : fmt(X.leadRouting.csvStartImportBtn, { n: csvRows.length })}
              </button>
            </div>
          </div>
        </div>
      )}
      {false && (<div><div><form><div><button>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
