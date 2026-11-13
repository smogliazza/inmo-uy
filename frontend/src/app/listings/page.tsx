"use client";

import React from "react";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useToast } from "@/components/ui/Toast";
import { useExtra, fmt } from "@/lib/i18n/extra";
import { parseCsv, mapPropertyCsvRows, downloadCsvTemplate } from "@/lib/csv";
import { useAiAssistantEnabled } from "@/lib/modules";
import { api, uploadFile } from "@/lib/api";
import { useSettings } from "@/lib/settings/useSettings";
import { DEPARTMENTS_UY } from "@/lib/catalogs";

export default function ListingsPage() {
  const { t } = useI18n();
  const X = useExtra();
  const toast = useToast();
  const AI_ON = useAiAssistantEnabled();
  // Brokerage rules (Settings > Properties) and this person's preferences
  const { policies, preferences } = useSettings();
  const lp = policies.properties;
  const PX = X.policy.properties;
  const isReq = (field: string) => lp.requiredFields.includes(field);
  const star = (field: string) => (isReq(field) ? " *" : "");
  const photoRuleActive = lp.photosRequiredToActivate > 0;

  const [properties, setProperties] = React.useState<any[]>([]);
  const [totalProperties, setTotalProperties] = React.useState(0);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = React.useState(false);
  const [csvRows, setCsvRows] = React.useState<Record<string, string>[]>([]);
  const [onDuplicate, setOnDuplicate] = React.useState<"skip" | "update">("skip");
  const [isImporting, setIsImporting] = React.useState(false);
  const [formData, setFormData] = React.useState({
    address: "",
    city: "",
    state: "",
    zip: "",
    price: "",
    beds: "",
    baths: "",
    sqft: "",
    status: "COMING_SOON",
    propertyType: "",
    neighborhood: "",
    yearBuilt: "",
    description: "",
  });
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [zillowId, setZillowId] = React.useState("");
  const [isZillowLoading, setIsZillowLoading] = React.useState(false);

  // Media Modal State
  const [isMediaModalOpen, setIsMediaModalOpen] = React.useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = React.useState<
    string | null
  >(null);
  const [mediaAssets, setMediaAssets] = React.useState<any[]>([]);
  const [isMediaSubmitting, setIsMediaSubmitting] = React.useState(false);
  const [isUploadingFiles, setIsUploadingFiles] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [mediaFormData, setMediaFormData] = React.useState({
    url: "",
    type: "image",
  });

  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState("ALL");

  const fetchProperties = (page = 1) => {
    setLoading(true);
    const token = localStorage.getItem("token");
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/properties?page=${page}&limit=12`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        setProperties(data.data || []);
        setTotalProperties(data.total || 0);
        setCurrentPage(data.page || 1);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  React.useEffect(() => {
    fetchProperties(1);
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleMediaChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    setMediaFormData({ ...mediaFormData, [e.target.name]: e.target.value });
  };

  const openMediaModal = async (propertyId: string) => {
    setSelectedPropertyId(propertyId);
    setIsMediaModalOpen(true);
    setMediaAssets([]); // clear until loaded

    const token = localStorage.getItem("token");
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/media?propertyId=${propertyId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (res.ok) {
        const data = await res.json();
        setMediaAssets(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error("Failed to fetch media assets", error);
    }
  };

  const closeMediaModal = () => {
    setIsMediaModalOpen(false);
    setSelectedPropertyId(null);
    setMediaFormData({ url: "", type: "image" });
  };

  const filteredProperties = properties.filter((prop) => {
    const matchesSearch = `${prop.address} ${prop.city} ${prop.zip}`
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesStatus =
      filterStatus === "ALL" || prop.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  // A blank form. New listings start Coming Soon when the brokerage wants photos before a listing goes Active.
  const blankForm = () => ({
    address: "", city: "", state: "", zip: "", price: "", beds: "", baths: "", sqft: "",
    status: photoRuleActive ? "COMING_SOON" : preferences.properties.defaultStatus,
    propertyType: "", neighborhood: "", yearBuilt: "", description: "",
  });
  const openAddModal = () => { setFormData(blankForm()); setIsAddModalOpen(true); };

  // Coming Soon -> Active (the server checks the photo rule and tells us what is missing)
  const goActive = async (id: string) => {
    try {
      await api(`/api/properties/${id}`, { method: "PATCH", body: { status: "ACTIVE" } });
      fetchProperties(currentPage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : X.common.error);
    }
  };

  const handleAddProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/properties`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setIsAddModalOpen(false);
        setFormData(blankForm());
        fetchProperties();
      } else if (res.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.location.href = "/login";
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || "Failed to add listing. Please try again.");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleZillowAutofill = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!zillowId) { toast.error(X.catalog.zillowMissing); return; }
    
    setIsZillowLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/integrations/zillow/fetch?zpid=${zillowId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (res.ok) {
        const { data } = await res.json();
        const addressParts = data.address.split(", ");
        
        setFormData(prev => ({
          ...prev,
          address: addressParts[0] || "",
          city: addressParts[1] || "",
          state: addressParts[2]?.split(" ")[0] || "",
          zip: addressParts[2]?.split(" ")[1] || "",
          price: data.price ? String(data.price) : prev.price,
          beds: data.beds ? String(data.beds) : prev.beds,
          baths: data.baths ? String(data.baths) : prev.baths,
          sqft: data.sqft ? String(data.sqft) : prev.sqft
        }));
        // alert(`Autofilled data from Zillow for property ID: ${zillowId}`);
      } else {
        toast.error(X.catalog.zillowFailed);
      }
    } catch (error) {
      console.error(error);
      toast.error(X.catalog.networkError);
    } finally {
      setIsZillowLoading(false);
    }
  };

  const handleAddMedia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPropertyId) return;
    if (mediaFormData.type === "image" && photoRoom === 0) {
      toast.error(fmt(PX.photoLimitReached, { n: lp.maxPhotosPerListing }));
      return;
    }
    setIsMediaSubmitting(true);
    try {
      await api("/api/media", {
        method: "POST",
        body: {
          ...mediaFormData,
          propertyId: selectedPropertyId,
        },
      });

      await openMediaModal(selectedPropertyId);
      fetchProperties(currentPage);
      setMediaFormData({ url: "", type: "image" });
    } catch (error) {
      console.error(error);
      toast.error("Failed to add media asset. Please check the URL and try again.");
    } finally {
      setIsMediaSubmitting(false);
    }
  };

  // Photo cap from the brokerage's Properties rules (floor plans and videos don't count)
  const photoCount = mediaAssets.filter((a) => String(a.type || "").toLowerCase() === "image").length;
  const photoRoom = lp.maxPhotosPerListing > 0 ? Math.max(0, lp.maxPhotosPerListing - photoCount) : Infinity;

  const handleUploadPhotoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !selectedPropertyId) return;
    let chosen = Array.from(files);
    if (chosen.length > photoRoom) {
      toast.error(fmt(PX.photoLimitReached, { n: lp.maxPhotosPerListing }));
      chosen = chosen.slice(0, photoRoom);
      if (chosen.length === 0) { if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    }
    setIsUploadingFiles(true);
    try {
      for (const file of chosen) {
        const uploaded = await uploadFile(file, "PUBLIC");
        await api("/api/media", {
          method: "POST",
          body: {
            url: uploaded.url,
            storageKey: uploaded.storageKey,
            sizeBytes: uploaded.sizeBytes,
            mimeType: uploaded.mimeType,
            type: "image",
            propertyId: selectedPropertyId,
          },
        });
      }
      toast.success(X.listings.photoUploaded);
      await openMediaModal(selectedPropertyId);
      fetchProperties(currentPage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : X.common.error);
    } finally {
      setIsUploadingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteMedia = async (assetId: string) => {
    if (!selectedPropertyId) return;
    if (!window.confirm(X.common.confirmDelete)) return;
    try {
      await api(`/api/media/${assetId}`, { method: "DELETE" });
      toast.success(X.listings.photoDeleted);
      await openMediaModal(selectedPropertyId);
      fetchProperties(currentPage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : X.common.error);
    }
  };

  const handleReorderMedia = async (newOrderedAssets: any[]) => {
    if (!selectedPropertyId) return;
    setMediaAssets(newOrderedAssets);
    try {
      const updated = await api("/api/media/reorder", {
        method: "PATCH",
        body: {
          propertyId: selectedPropertyId,
          orderedIds: newOrderedAssets.map((a) => a.id),
        },
      });
      setMediaAssets(updated);
      fetchProperties(currentPage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : X.common.error);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out text-foreground">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 pb-6 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t.listings.title}
          </h1>
          <p className="text-foreground/50 mt-1 text-sm">
            {t.listings.subtitle}
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="px-6 py-2.5 bg-primary text-background hover:opacity-90 transition-opacity duration-300 rounded-xl text-base font-semibold shadow-md w-full md:w-auto text-center"
        >
          {t.listings.addListing}
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center bg-background/50 ring-1 ring-border/50 rounded-2xl p-5 shadow-sm">
        <input
          type="text"
          placeholder={t.listings.searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 max-w-md px-4 py-2.5 bg-background border border-border/60 rounded-xl font-sans text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all shadow-sm placeholder:text-foreground/40"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-4 py-2.5 bg-background border border-border/60 rounded-xl font-sans text-base text-foreground/80 outline-none cursor-pointer focus:border-primary focus:ring-1 focus:ring-primary transition-all shadow-sm appearance-none md:w-48"
        >
          <option value="ALL">{t.listings.filters.allStatuses}</option>
          <option value="ACTIVE">{t.listings.modal.statusActive}</option>
          <option value="COMING_SOON">
            {t.listings.modal.statusComingSoon}
          </option>
          <option value="IN_CONTRACT">
            {t.listings.modal.statusInContract}
          </option>
          <option value="SOLD">{t.listings.modal.statusSold}</option>
        </select><button type="button" onClick={() => { setCsvRows([]); setIsImportModalOpen(true); }} className="px-4 py-2.5 bg-surface border border-border rounded-xl text-sm font-semibold text-foreground hover:bg-background transition-colors whitespace-nowrap">{X.leadRouting.csvImportBtn}</button>
        <select className="hidden">
        </select>
        <div className="flex gap-2 bg-background ring-1 ring-border/40 rounded-xl p-1 md:ml-auto w-full md:w-auto shadow-sm">
          <button className="flex-1 md:flex-none px-6 py-2 bg-surface rounded-lg text-foreground text-sm font-semibold shadow-sm ring-1 ring-border/50">
            {t.listings.viewOptions.grid}
          </button>
          <button className="flex-1 md:flex-none px-6 py-2 text-foreground/50 hover:text-foreground text-sm font-medium transition-colors">
            {t.listings.viewOptions.list}
          </button>
        </div>
      </div>

      {/* Property Grid */}
      {loading ? (
        <div className="py-24 border border-border bg-surface/30 text-center text-foreground/50 tracking-widest uppercase text-sm">
          {t.listings.table.loading}
        </div>
      ) : filteredProperties.length === 0 ? (
        <div className="py-24 border border-border bg-surface/30 text-center text-foreground/50 tracking-widest uppercase text-sm">
          {t.listings.table.noProperties}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
          {filteredProperties.map((prop) => (
            <div
              key={prop.id}
              className="bg-background ring-1 ring-border/50 rounded-2xl overflow-hidden hover:shadow-md transition-all duration-300 group flex flex-col"
            >
              <div className="h-64 relative overflow-hidden bg-surface flex items-center justify-center">
                {(prop.mediaAssets?.[0]?.url || prop.featuredImage || prop.image) ? (
                  <img
                    src={prop.mediaAssets?.[0]?.url || prop.featuredImage || prop.image}
                    alt={prop.address}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                  />
                ) : (
                  <span className="text-3xl text-foreground/20 font-sans font-bold">
                    No Image
                  </span>
                )}
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />
                <div className="absolute top-4 left-4">
                  <span
                    className={`px-3 py-1 text-sm font-sans font-semibold rounded-md backdrop-blur-md shadow-sm border border-white/20 text-white
                                        ${prop.status === "ACTIVE" ? "bg-primary/90" : ""}
                                        ${prop.status === "IN_CONTRACT" ? "bg-black/60" : ""}
                                        ${prop.status === "SOLD" ? "bg-green-600/80" : ""}
                                        ${prop.status === "COMING_SOON" ? "bg-blue-600/80" : ""}
                                    `}
                  >
                    {prop.status === "IN_CONTRACT"
                      ? t.listings.modal.statusInContract
                      : prop.status === "ACTIVE"
                        ? t.listings.modal.statusActive
                        : prop.status === "SOLD"
                          ? t.listings.modal.statusSold
                          : t.listings.modal.statusComingSoon}
                  </span>
                </div>
              </div>
              <div className="p-6 flex flex-col flex-1">
                <h3 className="font-sans text-xl font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors duration-300">
                  {prop.address}
                </h3>
                <p className="font-sans text-foreground/60 text-base font-medium mt-1">
                  {prop.city}, {prop.state} {prop.zip}
                </p>

                <div className="mt-6 flex items-center gap-6 text-base text-foreground/80 border-b border-border/40 pb-6 font-sans">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-foreground/50">
                      {t.listings.card.beds}
                    </span>
                    <span className="font-sans text-lg font-semibold">{prop.beds}</span>
                  </div>
                  <div className="w-px h-8 bg-border/40" />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-foreground/50">
                      {t.listings.card.baths}
                    </span>
                    <span className="font-sans text-lg font-semibold">{prop.baths}</span>
                  </div>
                  <div className="w-px h-8 bg-border/40" />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-foreground/50">
                      {t.listings.card.sqft}
                    </span>
                    <span className="font-sans text-lg font-semibold">
                      {prop.sqft || "-"}
                    </span>
                  </div>
                </div>

                <div className="mt-6 flex items-end justify-between mt-auto pt-2">
                  <span className="font-sans text-2xl font-bold text-foreground tracking-tight">
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                      minimumFractionDigits: 0,
                    }).format(prop.price)}
                  </span>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openMediaModal(prop.id);
                      }}
                      className="font-sans text-sm font-medium text-foreground/60 hover:text-foreground transition-colors duration-300"
                    >
                      {t.listings.media.photos}
                    </button>
                    {prop.status === "COMING_SOON" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); goActive(prop.id); }}
                        className="font-sans text-sm font-medium text-primary hover:text-primary-hover transition-colors duration-300"
                      >
                        {PX.goActive}
                      </button>
                    )}
                    {AI_ON && <a
                      href={`/marketing?skill=listing_description&propertyId=${prop.id}`}
                      className="font-sans text-sm font-medium text-foreground/60 hover:text-foreground transition-colors duration-300"
                    >
                      ✨ {X.listings.aiDescribe}
                    </a>}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(`${window.location.origin}/public-listings/${prop.id}?openhouse=1`);
                        toast.success(X.listings.linkCopied);
                      }}
                      title={X.listings.openHouseLink}
                      className="font-sans text-sm font-medium text-foreground/60 hover:text-foreground transition-colors duration-300"
                    >
                      QR
                    </button>
                    <a
                      href={`/public-listings/${prop.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-sans text-base font-semibold text-primary hover:text-primary-hover transition-colors duration-300 flex items-center gap-1"
                    >
                      {X.listings.publicPage} ↗
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {totalProperties > 0 && (
        <div className="flex items-center justify-between text-sm tracking-widest uppercase text-foreground/50 pt-8 border-t border-border">
          <span>
            {t.listings.pagination.showing}{" "}
            <span className="text-foreground font-serif text-base">
              {filteredProperties.length}
            </span>{" "}
            {t.listings.pagination.of}{" "}
            <span className="text-foreground font-serif text-base">
              {totalProperties}
            </span>{" "}
            {t.listings.pagination.listings}
          </span>
          <div className="flex gap-4">
            <button
              disabled={currentPage === 1 || loading}
              onClick={() => fetchProperties(currentPage - 1)}
              className="hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-foreground/50"
            >
              &larr; {t.listings.pagination.previous}
            </button>
            <button
              disabled={currentPage * 12 >= totalProperties || loading}
              onClick={() => fetchProperties(currentPage + 1)}
              className="hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-foreground/50"
            >
              {t.listings.pagination.next} &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Add Property Modal Overlay */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-300 p-4">
          <div className="bg-background ring-1 ring-border/50 shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] rounded-3xl">
            <div className="p-8 border-b border-border/40 flex justify-between items-center bg-surface/30">
              <h2 className="font-sans text-2xl font-semibold text-foreground">
                {t.listings.modal.title}
              </h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-foreground/40 hover:text-foreground text-3xl font-light transition-colors leading-none"
              >
                &times;
              </button>
            </div>
            <form
              onSubmit={handleAddProperty}
              className="p-8 overflow-y-auto space-y-6"
            >
              
              {/* Zillow import: a New York tool, shown only with the brokerage's "New York concepts" setting */}
              {policies.properties.usStyleDeal && <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-6 mb-8 flex flex-col md:flex-row gap-4 items-end animate-in fade-in duration-500">
                <div className="flex-1 w-full">
                  <label className="block font-sans text-sm font-semibold text-blue-900/60 mb-2">
                    {X.catalog.zillowTitle}
                  </label>
                  <input
                    type="text"
                    value={zillowId}
                    onChange={(e) => setZillowId(e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-blue-200 rounded-xl text-base text-blue-900 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none transition-all placeholder:text-blue-900/30 shadow-sm"
                    placeholder={X.catalog.zillowPlaceholder}
                  />
                </div>
                <button
                  onClick={handleZillowAutofill}
                  disabled={isZillowLoading}
                  type="button"
                  className="w-full md:w-auto px-6 py-3 bg-blue-600 text-white rounded-xl text-base font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-md whitespace-nowrap flex-shrink-0"
                >
                  {isZillowLoading ? X.catalog.zillowLoading : X.catalog.zillowBtn}
                </button>
              </div>}

              <div>
                <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                  {t.listings.modal.street}
                </label>
                <input
                  required
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  type="text"
                  className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-foreground/30 shadow-sm"
                  placeholder={X.labels.addressPlaceholder}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {t.listings.modal.city}
                  </label>
                  <input
                    required
                    name="city"
                    value={formData.city}
                    onChange={handleChange}
                    type="text"
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all shadow-sm"
                  />
                </div>
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {t.listings.modal.state}
                  </label>
                  <select
                    name="state"
                    value={formData.state}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all appearance-none cursor-pointer shadow-sm"
                  >
                    <option value="">{X.catalog.choose}</option>
                    {[...DEPARTMENTS_UY, ...(formData.state && !(DEPARTMENTS_UY as readonly string[]).includes(formData.state) ? [formData.state] : [])].map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {t.listings.modal.zip}
                  </label>
                  <input
                    required
                    name="zip"
                    value={formData.zip}
                    onChange={handleChange}
                    type="text"
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all shadow-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {t.listings.modal.price}
                  </label>
                  <input
                    required
                    name="price"
                    value={formData.price}
                    onChange={handleChange}
                    type="number"
                    min="0"
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all font-sans placeholder:text-foreground/30 shadow-sm"
                    placeholder="1500000"
                  />
                </div>
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {t.listings.modal.sqft}{star("sqft")}
                  </label>
                  <input
                    required={isReq("sqft")}
                    name="sqft"
                    value={formData.sqft}
                    onChange={handleChange}
                    type="number"
                    min="0"
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all font-sans placeholder:text-foreground/30 shadow-sm"
                    placeholder="1200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {t.listings.modal.beds}
                  </label>
                  <input
                    required
                    name="beds"
                    value={formData.beds}
                    onChange={handleChange}
                    type="number"
                    step="0.5"
                    min="0"
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all font-sans placeholder:text-foreground/30 shadow-sm"
                    placeholder="2"
                  />
                </div>
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {t.listings.modal.baths}
                  </label>
                  <input
                    required
                    name="baths"
                    value={formData.baths}
                    onChange={handleChange}
                    type="number"
                    step="0.5"
                    min="0"
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all font-sans placeholder:text-foreground/30 shadow-sm"
                    placeholder="2"
                  />
                </div>
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {t.listings.modal.status}
                  </label>
                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleChange}
                    disabled={photoRuleActive}
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all appearance-none cursor-pointer shadow-sm disabled:opacity-60"
                  >
                    <option value="COMING_SOON">
                      {t.listings.modal.statusComingSoon}
                    </option>
                    <option value="ACTIVE">
                      {t.listings.modal.statusActive}
                    </option>
                    <option value="IN_CONTRACT">
                      {t.listings.modal.statusInContract}
                    </option>
                    <option value="SOLD">{t.listings.modal.statusSold}</option>
                  </select>
                </div>
              </div>

              {photoRuleActive && (
                <p className="text-sm text-foreground/60 -mt-2">{fmt(PX.photoRuleHint, { n: lp.photosRequiredToActivate })}</p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {PX.field.propertyType}{star("propertyType")}
                  </label>
                  <select
                    name="propertyType"
                    value={formData.propertyType}
                    onChange={handleChange}
                    required={isReq("propertyType")}
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all appearance-none cursor-pointer shadow-sm"
                  >
                    <option value="">—</option>
                    {/* The brokerage's catalog (Settings > Properties); a legacy value already saved stays selectable */}
                    {[...policies.properties.propertyTypes, ...(formData.propertyType && !policies.properties.propertyTypes.includes(formData.propertyType) ? [formData.propertyType] : [])].map((v) => (
                      <option key={v} value={v}>{(X.catalog.propertyTypes as Record<string, string>)[v] ?? v.replace("_", " ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {PX.field.neighborhood}{star("neighborhood")}
                  </label>
                  <input
                    name="neighborhood"
                    value={formData.neighborhood}
                    onChange={handleChange}
                    required={isReq("neighborhood")}
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all font-sans shadow-sm"
                  />
                </div>
                <div>
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                    {PX.field.yearBuilt}{star("yearBuilt")}
                  </label>
                  <input
                    name="yearBuilt"
                    value={formData.yearBuilt}
                    onChange={handleChange}
                    required={isReq("yearBuilt")}
                    type="number"
                    min="1600"
                    max="2100"
                    className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all font-sans shadow-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block font-sans text-sm font-semibold text-foreground/60 mb-2">
                  {PX.field.description}{star("description")}
                  {lp.descriptionMaxChars > 0 && (
                    <span className="font-normal text-foreground/40"> ({formData.description.length}/{lp.descriptionMaxChars})</span>
                  )}
                </label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  required={isReq("description")}
                  maxLength={lp.descriptionMaxChars > 0 ? lp.descriptionMaxChars : undefined}
                  rows={4}
                  className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all font-sans shadow-sm resize-none"
                />
              </div>

              <div className="pt-6 flex justify-end gap-3 mt-8 border-t border-border/40">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-6 py-2.5 bg-surface border border-border/60 text-foreground/70 rounded-xl text-base font-semibold hover:text-foreground transition-colors shadow-sm"
                >
                  {t.listings.modal.cancel}
                </button>
                <button
                  disabled={isSubmitting}
                  type="submit"
                  className="px-6 py-2.5 bg-primary text-background rounded-xl text-base font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-md"
                >
                  {isSubmitting
                    ? t.listings.modal.saving
                    : t.listings.modal.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Media Asset Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-2xl p-6 shadow-2xl relative space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h2 className="text-xl font-bold text-foreground">{X.leadRouting.csvModalTitleListings}</h2>
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
                    setCsvRows(mapPropertyCsvRows(parseCsv(text)));
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => downloadCsvTemplate("listings-template.csv", "address,city,state,zip,price,beds,baths,sqft,status,propertyType\nUruguay 1234,Salto,Salto,50000,290000,4,2,180,ACTIVE,CASA")}
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
                        <th className="p-2">Address</th>
                        <th className="p-2">City</th>
                        <th className="p-2">Price</th>
                        <th className="p-2">Beds/Baths</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-b border-border/40 last:border-0">
                          <td className="p-2 text-foreground">{r.address || "—"}</td>
                          <td className="p-2 text-foreground/70">{r.city || "New York"}</td>
                          <td className="p-2 text-foreground/70">{r.price || "—"}</td>
                          <td className="p-2 text-foreground/70">{r.beds || 1} / {r.baths || 1}</td>
                          <td className="p-2 text-foreground/70">{r.status || "ACTIVE"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-3 border-t border-border">
              <button type="button" onClick={() => setIsImportModalOpen(false)} className="px-4 py-2 bg-background border border-border rounded-lg text-sm text-foreground/70">
                {t.listings.modal.cancel}
              </button>
              <button
                type="button"
                disabled={csvRows.length === 0 || isImporting}
                onClick={async () => {
                  setIsImporting(true);
                  try {
                    const res = await api("/api/properties/import", { method: "POST", body: { rows: csvRows, onDuplicate } });
                    toast.success(fmt(X.leadRouting.csvResultSummary, { created: res.created, updated: res.updated, skipped: res.skipped }));
                    setIsImportModalOpen(false);
                    setCsvRows([]);
                    fetchProperties(1);
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
      {isMediaModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-300 p-4">
          <div className="bg-background ring-1 ring-border/50 shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] rounded-3xl">
            <div className="p-8 border-b border-border/40 flex justify-between items-center bg-surface/30 shrink-0">
              <div>
                <h2 className="font-sans text-2xl font-semibold text-foreground">
                  {t.listings.media.title}
                </h2>
                <p className="font-sans text-base text-foreground/60 mt-2">
                  {t.listings.media.subtitle}
                </p>
              </div>
              <button
                onClick={closeMediaModal}
                className="text-foreground/40 hover:text-foreground text-3xl font-light transition-colors leading-none"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-8">
              {/* Direct Photo File Upload Dropzone */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={(e) => handleUploadPhotoFiles(e.target.files)}
                />
                <div
                  onClick={() => !isUploadingFiles && fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isUploadingFiles) handleUploadPhotoFiles(e.dataTransfer.files);
                  }}
                  className="border-2 border-dashed border-primary/40 hover:border-primary bg-surface/40 hover:bg-surface/70 rounded-2xl p-6 text-center cursor-pointer transition-all"
                >
                  <p className="font-sans text-base font-semibold text-primary">
                    {isUploadingFiles ? t.listings.media.uploading : `📷 ${X.listings.uploadPhotosBtn}`}
                  </p>
                  <p className="font-sans text-xs text-foreground/50 mt-1">
                    {X.listings.dropPhotosHere}
                    {lp.maxPhotosPerListing > 0 && ` · ${photoCount}/${lp.maxPhotosPerListing}`}
                  </p>
                </div>
              </div>

              {/* Existing Media Grid */}
              <div>
                <h3 className="font-sans text-sm uppercase tracking-widest text-foreground/40 mb-4 border-b border-border pb-2">
                  {t.listings.media.currentAssets}
                </h3>
                {mediaAssets.length === 0 ? (
                  <div className="py-12 text-center border border-dashed border-border bg-surface/30 text-foreground/30 font-sans text-sm uppercase tracking-widest">
                    {t.listings.media.noMedia}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {mediaAssets.map((asset, idx) => {
                      const lowerType = String(asset.type || "").toLowerCase();
                      const isImg = lowerType === "image" || lowerType === "floorplan";
                      return (
                        <div
                          key={asset.id}
                          className="aspect-square relative group bg-surface border border-border rounded-xl overflow-hidden"
                        >
                          {isImg ? (
                            <img
                              src={asset.url}
                              alt="Property Asset"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-surface/50 font-sans text-sm uppercase tracking-widest text-foreground/50">
                              {t.listings.media.videoTour}
                            </div>
                          )}
                          <div className="absolute top-2 left-2 flex gap-1.5 items-center">
                            {idx === 0 && (
                              <span className="bg-primary text-background px-2 py-0.5 text-[11px] font-sans font-bold uppercase tracking-wider rounded">
                                {X.listings.coverBadge}
                              </span>
                            )}
                            <span className="bg-background/80 backdrop-blur-sm px-2 py-0.5 text-[11px] font-sans uppercase tracking-widest text-foreground rounded">
                              {asset.type}
                            </span>
                          </div>

                          {/* Reorder & Delete Overlay */}
                          <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1">
                              {idx > 0 && (
                                <button
                                  type="button"
                                  title={X.listings.moveLeft}
                                  onClick={() => {
                                    const next = [...mediaAssets];
                                    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                    handleReorderMedia(next);
                                  }}
                                  className="px-2 py-1 bg-white/20 hover:bg-white/40 text-white rounded text-xs"
                                >
                                  ←
                                </button>
                              )}
                              {idx < mediaAssets.length - 1 && (
                                <button
                                  type="button"
                                  title={X.listings.moveRight}
                                  onClick={() => {
                                    const next = [...mediaAssets];
                                    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                    handleReorderMedia(next);
                                  }}
                                  className="px-2 py-1 bg-white/20 hover:bg-white/40 text-white rounded text-xs"
                                >
                                  →
                                </button>
                              )}
                              {idx > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = [asset, ...mediaAssets.filter((_, i) => i !== idx)];
                                    handleReorderMedia(next);
                                  }}
                                  className="px-2 py-1 bg-primary/90 hover:bg-primary text-background rounded text-[11px] font-semibold"
                                >
                                  {X.listings.setAsCover}
                                </button>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteMedia(asset.id)}
                              className="px-2 py-1 bg-red-600/90 hover:bg-red-600 text-white rounded text-xs font-semibold"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Add Media Form Footer */}
            <div className="p-8 border-t border-border/40 bg-background shrink-0">
              <h3 className="font-sans text-sm font-semibold text-foreground/60 mb-4">
                {X.listings.orAddByLink}
              </h3>
              <form
                onSubmit={handleAddMedia}
                className="flex flex-col md:flex-row gap-4 items-start md:items-end"
              >
                <div className="flex-1 w-full">
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-1">
                    {t.listings.media.assetUrl}
                  </label>
                  <input
                    required
                    name="url"
                    value={mediaFormData.url}
                    onChange={handleMediaChange}
                    type="url"
                    placeholder="https://example.com/tour-or-image"
                    className="w-full px-4 py-2.5 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-foreground/30 shadow-sm"
                  />
                </div>
                <div className="w-full md:w-48 shrink-0">
                  <label className="block font-sans text-sm font-semibold text-foreground/60 mb-1">
                    {t.listings.media.assetType}
                  </label>
                  <select
                    name="type"
                    value={mediaFormData.type}
                    onChange={handleMediaChange}
                    className="w-full px-4 py-2.5 bg-background border border-border/60 rounded-xl text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all appearance-none cursor-pointer shadow-sm"
                  >
                    <option value="image">{t.listings.media.typeImage}</option>
                    <option value="video">{t.listings.media.typeVideo}</option>
                    <option value="floorplan">
                      {t.listings.media.typeFloorplan}
                    </option>
                  </select>
                </div>
                <button
                  disabled={isMediaSubmitting}
                  type="submit"
                  className="w-full md:w-auto px-6 py-2.5 bg-primary text-background rounded-xl text-base font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0 shadow-md"
                >
                  {isMediaSubmitting
                    ? t.listings.media.uploading
                    : t.listings.media.uploadBtn}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
