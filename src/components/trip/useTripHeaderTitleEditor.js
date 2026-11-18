import { useEffect, useRef, useState } from "react";

export default function useTripHeaderTitleEditor({ title, canEditTitle, onUpdateTrip }) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleError, setTitleError] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const titleInputRef = useRef(null);
  const titleSaveRef = useRef(false);

  useEffect(() => {
    if (!isEditingTitle) return;
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [isEditingTitle]);

  function beginTitleEdit() {
    setTitleDraft(title || "");
    setTitleError("");
    setIsEditingTitle(true);
  }

  function handleTitleChange(event) {
    setTitleDraft(event.target.value);
    if (titleError) setTitleError("");
  }

  function cancelTitleEdit() {
    setTitleDraft(title || "");
    setTitleError("");
    setIsEditingTitle(false);
    setIsSavingTitle(false);
    titleSaveRef.current = false;
  }

  async function saveTitleDraft() {
    if (!canEditTitle || titleSaveRef.current) return false;
    const nextTitle = titleDraft.trim();
    const currentTitle = String(title || "").trim();
    if (!nextTitle) {
      setTitleError("旅程名稱不能為空白");
      return false;
    }
    if (nextTitle === currentTitle) {
      setTitleError("");
      setIsEditingTitle(false);
      return true;
    }
    setTitleError("");
    titleSaveRef.current = true;
    setIsSavingTitle(true);
    let result;
    try {
      result = await onUpdateTrip({ title: nextTitle });
    } catch (error) {
      result = { ok: false, error };
    }
    if (result?.ok === false) {
      titleSaveRef.current = false;
      setIsSavingTitle(false);
      setTitleError("儲存失敗，請再試一次");
      return false;
    }
    titleSaveRef.current = false;
    setIsSavingTitle(false);
    setIsEditingTitle(false);
    setTitleDraft("");
    return true;
  }

  function handleTitleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      saveTitleDraft();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelTitleEdit();
    }
  }

  function handleTitleBlur() {
    saveTitleDraft();
  }

  return {
    beginTitleEdit,
    handleTitleBlur,
    handleTitleChange,
    handleTitleKeyDown,
    isEditingTitle,
    isSavingTitle,
    saveTitleDraft,
    titleDraft,
    titleError,
    titleInputRef,
  };
}
