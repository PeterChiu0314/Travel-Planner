import { useEffect, useRef, useState } from "react";

export default function useTripHeaderDestinationEditor({
  trip,
  activeSection,
  canOpenDestinationPopover,
  onUpdateTrip,
  tripDestinationParts,
  destinationPatchFromParts,
  combineTripDestination,
}) {
  const [isDestinationPopoverOpen, setIsDestinationPopoverOpen] = useState(false);
  const [countryDraft, setCountryDraft] = useState("");
  const [cityDraft, setCityDraft] = useState("");
  const [destinationError, setDestinationError] = useState("");
  const [isSavingDestination, setIsSavingDestination] = useState(false);
  const destinationPopoverRef = useRef(null);
  const destinationButtonRef = useRef(null);
  const countryInputRef = useRef(null);
  const cityInputRef = useRef(null);
  const destinationSaveRef = useRef(false);

  useEffect(() => {
    if (!isDestinationPopoverOpen) return undefined;
    requestAnimationFrame(() => {
      countryInputRef.current?.focus();
    });
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDestinationPopover();
      }
    }
    function closeOnOutsidePointer(event) {
      if (destinationPopoverRef.current && !destinationPopoverRef.current.contains(event.target)) {
        closeDestinationPopover();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [isDestinationPopoverOpen]);

  useEffect(() => {
    if (!isDestinationPopoverOpen) return;
    closeDestinationPopover({ restoreFocus: false });
  }, [activeSection, trip?.id]);

  function beginDestinationEdit() {
    const { country, city } = tripDestinationParts(trip);
    setCountryDraft(country);
    setCityDraft(city);
    setDestinationError("");
    setIsDestinationPopoverOpen(true);
  }

  function closeDestinationPopover({ restoreFocus = true } = {}) {
    setIsDestinationPopoverOpen(false);
    setDestinationError("");
    setIsSavingDestination(false);
    destinationSaveRef.current = false;
    if (restoreFocus) {
      requestAnimationFrame(() => {
        destinationButtonRef.current?.focus();
      });
    }
  }

  function handleCountryChange(event) {
    setCountryDraft(event.target.value);
    if (destinationError) setDestinationError("");
  }

  function handleCityChange(event) {
    setCityDraft(event.target.value);
    if (destinationError) setDestinationError("");
  }

  async function saveDestinationDrafts() {
    if (!canOpenDestinationPopover || destinationSaveRef.current) return false;
    const nextCountry = countryDraft.trim();
    const nextCity = cityDraft.trim();
    const patch = destinationPatchFromParts(nextCountry, nextCity);
    const currentParts = tripDestinationParts(trip);
    const currentDestination = combineTripDestination(currentParts.country, currentParts.city);
    if (
      patch.destination_country === (currentParts.country || null) &&
      patch.destination_city === (currentParts.city || null) &&
      patch.destination === currentDestination
    ) {
      closeDestinationPopover();
      return true;
    }
    setDestinationError("");
    destinationSaveRef.current = true;
    setIsSavingDestination(true);
    let result;
    try {
      result = await onUpdateTrip(patch);
    } catch (error) {
      result = { ok: false, error };
    }
    if (result?.ok === false) {
      destinationSaveRef.current = false;
      setIsSavingDestination(false);
      setDestinationError("儲存失敗，請再試一次");
      return false;
    }
    destinationSaveRef.current = false;
    setIsSavingDestination(false);
    closeDestinationPopover();
    return true;
  }

  function handleDestinationKeyDown(event, field) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (field === "country") {
      cityInputRef.current?.focus();
      return;
    }
    saveDestinationDrafts();
  }

  return {
    beginDestinationEdit,
    cityDraft,
    cityInputRef,
    closeDestinationPopover,
    countryDraft,
    countryInputRef,
    destinationButtonRef,
    destinationError,
    destinationPopoverRef,
    handleCityChange,
    handleCountryChange,
    handleDestinationKeyDown,
    isDestinationPopoverOpen,
    isSavingDestination,
    saveDestinationDrafts,
  };
}
