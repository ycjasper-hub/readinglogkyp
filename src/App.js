import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  Check,
  X,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  User,
  Stamp,
  Loader2,
} from "lucide-react";

/* ============================================================
   請在這裡填入你的 GAS API 網址（Google Apps Script 部署後的 Web App URL）
   ============================================================ */
const GAS_API_URL =
  "https://script.google.com/macros/s/AKfycbwaz_Y2vw-RUtapzg74nZZdupoQIm9kR1MbUNaXcfrT9BdqpbSu_eu7prT0A2vtHFU/exec";

const BOOK_TITLE = "共讀計畫";
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const NO_PROGRESS_TEXT = "本日無進度";

// 網頁初始開啟時要顯示的月份（之後可用左右箭頭切換）
const INITIAL_YEAR = 2026;
const INITIAL_MONTH = 6; // 0-indexed → 7 月

// localStorage：記住使用者上次選擇的名字
const REMEMBERED_MEMBER_KEY = "reading-checkin:selected-member";
function getRememberedMember() {
  try {
    return window.localStorage.getItem(REMEMBERED_MEMBER_KEY) || "";
  } catch (err) {
    return ""; // 瀏覽器封鎖 localStorage 時，安靜地退回「沒有記住的名字」
  }
}
function saveRememberedMember(name) {
  try {
    window.localStorage.setItem(REMEMBERED_MEMBER_KEY, name);
  } catch (err) {
    // 忽略（例如無痕模式），不影響其他功能
  }
}
function clearRememberedMember() {
  try {
    window.localStorage.removeItem(REMEMBERED_MEMBER_KEY);
  } catch (err) {
    // 忽略
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function toDateKey(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}
function buildCalendarWeeks(year, month) {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay.getDay(); // 0=Sun
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
function isToday(year, month, day) {
  const now = new Date();
  return (
    day !== null &&
    now.getFullYear() === year &&
    now.getMonth() === month &&
    now.getDate() === day
  );
}

export default function ReadingCheckInCalendar() {
  const [members, setMembers] = useState([]);
  const [schedule, setSchedule] = useState({}); // { "2026-07-14": "Ch.1 導言", ... }
  const [dataStatus, setDataStatus] = useState("loading"); // loading | ready | error

  const [selectedMember, setSelectedMember] = useState("");
  const [entered, setEntered] = useState(false);

  const [currentYear, setCurrentYear] = useState(INITIAL_YEAR);
  const [currentMonth, setCurrentMonth] = useState(INITIAL_MONTH); // 0-indexed

  const [checkedInDates, setCheckedInDates] = useState({}); // { "2026-07-14": "提問內容" }
  const [modalDay, setModalDay] = useState(null); // 數字 1-31 或 null
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [justStamped, setJustStamped] = useState(false);
  const [toast, setToast] = useState("");

  const [refreshing, setRefreshing] = useState(false);

  const weeks = useMemo(
    () => buildCalendarWeeks(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  // 取得成員名單 + 進度表（同一支 GET API 一次回傳）
  // silent = true 時不會顯示整頁的 loading 畫面，只顯示右上角小小的「更新中」提示
  const fetchData = useCallback(async (silent = false) => {
    if (!GAS_API_URL || GAS_API_URL === "YOUR_GAS_WEB_APP_URL_HERE") {
      setDataStatus("error");
      return;
    }
    if (silent) setRefreshing(true);
    else setDataStatus("loading");
    try {
      const res = await fetch(GAS_API_URL, { method: "GET" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      setMembers(Array.isArray(data.members) ? data.members : []);
      setSchedule(
        data.schedule && typeof data.schedule === "object" ? data.schedule : {}
      );
      setDataStatus("ready");

      // 名冊抓到之後，如果本機記住的名字仍在名冊裡，就自動幫他選好
      const remembered = getRememberedMember();
      if (
        remembered &&
        Array.isArray(data.members) &&
        data.members.includes(remembered)
      ) {
        setSelectedMember((prev) => prev || remembered);
      }
    } catch (err) {
      if (silent) setToast("更新進度表時發生問題，暫時顯示上次讀取到的資料。");
      else setDataStatus("error");
    } finally {
      if (silent) setRefreshing(false);
    }
  }, []);

  // 網頁載入時抓一次資料
  useEffect(() => {
    fetchData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 使用者切換月份時，重新向 GAS 拉取最新的 schedule / members
  // （用 isFirstRun 避免跟上面「網頁載入」那次重複抓取）
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (entered) fetchData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentYear, currentMonth]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const goPrevMonth = useCallback(() => {
    setCurrentMonth((m) => {
      if (m === 0) {
        setCurrentYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const goNextMonth = useCallback(() => {
    setCurrentMonth((m) => {
      if (m === 11) {
        setCurrentYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  const openModal = useCallback((day) => {
    if (!day) return;
    setModalDay(day);
    setQuestion("");
    setSubmitError("");
    setJustStamped(false);
  }, []);

  const closeModal = useCallback(() => {
    setModalDay(null);
    setSubmitError("");
    setSubmitting(false);
  }, []);

  async function handleSubmitCheckin() {
    if (!question.trim()) {
      setSubmitError("請寫下一句提問或心得，再蓋章喔！");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    const dateKey = toDateKey(currentYear, currentMonth, modalDay);
    const payload = {
      name: selectedMember,
      date: dateKey,
      question: question.trim(),
    };
    try {
      // 注意：GAS Web App 常見作法是用 text/plain 避免瀏覽器送出 CORS 預檢請求（preflight）
      await fetch(GAS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      setCheckedInDates((prev) => ({ ...prev, [dateKey]: payload.question }));
      saveRememberedMember(selectedMember);
      setJustStamped(true);
      setToast(`${selectedMember}，${currentMonth + 1}/${modalDay} 打卡成功！`);
      setTimeout(() => closeModal(), 1100);
    } catch (err) {
      setSubmitError("送出時發生問題，請確認網路連線或稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------- 進入前：選擇姓名的畫面 ---------------- */
  if (!entered) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6 bg-[#EFEEE3]">
        <FontsAndKeyframes />
        <div className="relative w-full max-w-sm">
          <div className="absolute -inset-1 rounded-3xl bg-[#26323A]/5 rotate-1" />
          <div className="relative rounded-3xl bg-[#FBFAF4] border border-[#D8D3C0] shadow-[0_10px_30px_-12px_rgba(38,50,58,0.25)] px-7 py-9">
            <div className="flex items-center gap-2 mb-1 text-[#8A6A3A]">
              <BookOpen size={20} strokeWidth={2} />
              <span className="font-mono text-[11px] tracking-[0.25em] uppercase">
                Reading Log
              </span>
            </div>
            <h1
              className="text-[26px] leading-tight text-[#26323A] mt-2 mb-1"
              style={{ fontFamily: "'Noto Serif TC', serif", fontWeight: 700 }}
            >
              共讀打卡月曆
            </h1>
            <p className="text-[13px] text-[#5B6570] mb-7">
              進入前，請先在名冊上找到自己的名字。
            </p>

            <label className="block text-[12px] font-medium text-[#5B6570] mb-2 font-mono tracking-wide">
              我的名字
            </label>

            {dataStatus === "loading" && (
              <div className="flex items-center gap-2 text-[#8A6A3A] text-sm py-3">
                <Loader2 size={16} className="animate-spin" />
                名冊讀取中…
              </div>
            )}

            {dataStatus === "error" && (
              <div className="text-[13px] text-[#B33A2E] bg-[#B33A2E]/8 border border-[#B33A2E]/20 rounded-xl px-3 py-2.5 mb-3 leading-relaxed">
                無法讀取名冊。請確認頂端的{" "}
                <code className="font-mono text-[12px]">GAS_API_URL</code>{" "}
                是否已填入正確的 GAS 部署網址。
              </div>
            )}

            {dataStatus === "ready" && (
              <SearchableMemberSelect
                members={members}
                value={selectedMember}
                onChange={setSelectedMember}
              />
            )}

            <button
              disabled={!selectedMember}
              onClick={() => {
                saveRememberedMember(selectedMember);
                setEntered(true);
              }}
              className="w-full rounded-xl py-3 text-[15px] font-medium tracking-wide transition
                disabled:bg-[#D8D3C0] disabled:text-[#9A9585] disabled:cursor-not-allowed
                bg-[#26323A] text-[#FBFAF4] hover:bg-[#1B252B] active:scale-[0.99]"
            >
              進入月曆
            </button>

            {dataStatus === "error" && (
              <button
                onClick={() => {
                  setMembers(["示範用戶A", "示範用戶B", "示範用戶C"]);
                  setSchedule({
                    [toDateKey(INITIAL_YEAR, INITIAL_MONTH, 14)]: "Ch.1 導言",
                    [toDateKey(INITIAL_YEAR, INITIAL_MONTH, 15)]:
                      "Ch.1 p.15 ~ p.30",
                  });
                  setDataStatus("ready");
                }}
                className="w-full text-center text-[12px] text-[#8A6A3A] underline underline-offset-2 mt-3"
              >
                先用示範名單試用畫面
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- 主畫面：月曆 ---------------- */
  return (
    <div className="min-h-screen w-full bg-[#EFEEE3] px-3 py-6 sm:px-6 sm:py-10">
      <FontsAndKeyframes />

      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 sm:mb-8">
          <div>
            <div className="flex items-center gap-2 text-[#8A6A3A] mb-1">
              <BookOpen size={18} />
              <span className="font-mono text-[11px] tracking-[0.25em] uppercase">
                {BOOK_TITLE}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={goPrevMonth}
                aria-label="上一個月"
                className="w-8 h-8 flex items-center justify-center rounded-full border border-[#D8D3C0] bg-white text-[#26323A] hover:bg-[#F0EEDF] active:scale-95 transition"
              >
                <ChevronLeft size={17} />
              </button>
              <h1
                className="text-[26px] sm:text-[32px] text-[#26323A] leading-none min-w-[9ch] text-center"
                style={{
                  fontFamily: "'Noto Serif TC', serif",
                  fontWeight: 700,
                }}
              >
                {currentYear} 年 {currentMonth + 1} 月
              </h1>
              {refreshing && (
                <Loader2
                  size={15}
                  className="animate-spin text-[#8A6A3A]"
                  aria-label="更新中"
                />
              )}
              <button
                onClick={goNextMonth}
                aria-label="下一個月"
                className="w-8 h-8 flex items-center justify-center rounded-full border border-[#D8D3C0] bg-white text-[#26323A] hover:bg-[#F0EEDF] active:scale-95 transition"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <div className="text-right">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[#D8D3C0] px-3 py-1.5 text-[13px] text-[#26323A]">
              <User size={14} className="text-[#8A6A3A]" />
              {selectedMember}
            </div>
            <button
              onClick={() => {
                setEntered(false);
                setSelectedMember("");
                clearRememberedMember();
              }}
              className="block ml-auto mt-1.5 text-[11px] text-[#8A6A3A] underline underline-offset-2"
            >
              切換身分
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5 text-[12px] text-[#5B6570]">
          <LegendDot className="bg-[#4C7A5D]" label="我已打卡" />
          <LegendDot
            className="bg-white border border-[#C99A3E]"
            ring
            label="今天"
          />
          <LegendDot
            className="bg-white border border-[#D8D3C0]"
            label="尚未打卡"
          />
        </div>

        {/* Calendar card */}
        <div className="rounded-3xl bg-[#FBFAF4] border border-[#D8D3C0] shadow-[0_10px_30px_-14px_rgba(38,50,58,0.25)] p-3 sm:p-5">
          {/* Weekday row */}
          <div className="grid grid-cols-7 mb-2">
            {WEEKDAY_LABELS.map((w) => (
              <div
                key={w}
                className="text-center text-[11px] font-mono tracking-widest text-[#9A9585] py-1.5"
              >
                {w}
              </div>
            ))}
          </div>

          {/* Weeks */}
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {weeks.flatMap((week, wi) =>
              week.map((day, di) => {
                const dateKey = day
                  ? toDateKey(currentYear, currentMonth, day)
                  : null;
                return (
                  <DayCell
                    key={`${wi}-${di}`}
                    day={day}
                    progressText={dateKey ? schedule[dateKey] : ""}
                    today={isToday(currentYear, currentMonth, day)}
                    checkedIn={
                      dateKey ? Boolean(checkedInDates[dateKey]) : false
                    }
                    onClick={() => openModal(day)}
                  />
                );
              })
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-[#9A9585] mt-6 font-mono tracking-wide">
          點擊任一天的格子，寫下你的提問或心得，蓋上今天的打卡章
        </p>
      </div>

      {/* Modal */}
      {modalDay !== null && (
        <CheckinModal
          day={modalDay}
          dateKey={toDateKey(currentYear, currentMonth, modalDay)}
          progressText={
            schedule[toDateKey(currentYear, currentMonth, modalDay)]
          }
          question={question}
          setQuestion={setQuestion}
          submitting={submitting}
          submitError={submitError}
          justStamped={justStamped}
          onClose={closeModal}
          onSubmit={handleSubmitCheckin}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-50">
          <div className="flex items-center gap-2 rounded-full bg-[#26323A] text-[#FBFAF4] pl-3 pr-4 py-2.5 text-[13px] shadow-lg animate-[toastIn_0.3s_ease-out]">
            <Check size={16} className="text-[#8FBF9F]" />
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

function LegendDot({ className, label, ring }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block w-3 h-3 rounded-full ${className} ${
          ring ? "ring-2 ring-offset-1 ring-[#C99A3E]" : ""
        }`}
      />
      {label}
    </span>
  );
}

function DayCell({ day, progressText, today, checkedIn, onClick }) {
  if (!day) return <div className="aspect-square sm:aspect-[4/3]" />;

  const displayText = progressText || NO_PROGRESS_TEXT;
  const hasProgress = Boolean(progressText);

  return (
    <button
      onClick={onClick}
      className={`group relative aspect-square sm:aspect-[4/3] rounded-xl border text-left px-1.5 py-1.5 sm:px-2.5 sm:py-2 flex flex-col justify-between overflow-hidden transition
        ${
          checkedIn
            ? "bg-[#4C7A5D] border-[#3E6A4C] text-[#F4F8F1]"
            : "bg-white border-[#E4E0D2] text-[#26323A] hover:border-[#B7B197] hover:-translate-y-0.5"
        }
        ${today && !checkedIn ? "ring-2 ring-[#C99A3E]" : ""}
      `}
    >
      <div className="flex items-center justify-between">
        <span
          className={`font-mono text-[12px] sm:text-[13px] ${
            checkedIn ? "text-[#F4F8F1]" : "text-[#8A6A3A]"
          }`}
        >
          {day}
        </span>
        {checkedIn && (
          <Check size={13} strokeWidth={3} className="text-[#F4F8F1]" />
        )}
      </div>

      <span
        className={`hidden sm:block text-[10.5px] leading-snug line-clamp-2 ${
          checkedIn
            ? "text-[#DCEBE1]"
            : hasProgress
            ? "text-[#5B6570]"
            : "text-[#B0AB98] italic"
        }`}
      >
        {displayText}
      </span>

      {checkedIn && (
        <span className="hidden sm:inline-flex absolute bottom-1.5 right-1.5 text-[9px] font-mono tracking-wider text-[#DCEBE1]">
          已打卡
        </span>
      )}
    </button>
  );
}

function CheckinModal({
  day,
  dateKey,
  progressText,
  question,
  setQuestion,
  submitting,
  submitError,
  justStamped,
  onClose,
  onSubmit,
}) {
  const displayText = progressText || NO_PROGRESS_TEXT;
  const [, , monthStr, dayStr] = dateKey.match(/(\d+)-(\d+)-(\d+)/) || [];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div
        className="absolute inset-0 bg-[#1B252B]/45 backdrop-blur-[2px] animate-[fadeIn_0.2s_ease-out]"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[#FBFAF4] border border-[#D8D3C0] shadow-2xl px-6 pt-6 pb-7 animate-[sheetIn_0.25s_ease-out]">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-[#9A9585] hover:text-[#26323A] transition"
        >
          <X size={20} />
        </button>

        <div className="text-[11px] font-mono tracking-[0.2em] uppercase text-[#8A6A3A] mb-1">
          {dateKey}
        </div>
        <h2
          className="text-[22px] text-[#26323A] mb-3"
          style={{ fontFamily: "'Noto Serif TC', serif", fontWeight: 700 }}
        >
          {parseInt(monthStr, 10)} 月 {parseInt(dayStr, 10)} 日
        </h2>

        <div className="rounded-2xl bg-[#F0EEDF] border border-[#E4E0D2] px-4 py-3 mb-5">
          <div className="text-[10.5px] font-mono tracking-wide text-[#9A9585] mb-0.5">
            今日進度
          </div>
          <div
            className={`text-[13.5px] leading-relaxed ${
              progressText ? "text-[#3A4750]" : "text-[#B0AB98] italic"
            }`}
          >
            {displayText}
          </div>
        </div>

        {justStamped ? (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="animate-[stampIn_0.45s_cubic-bezier(0.2,1.4,0.4,1)]">
              <StampSeal />
            </div>
            <p className="mt-4 text-[14px] text-[#26323A] font-medium">
              已完成打卡！
            </p>
          </div>
        ) : (
          <>
            <label className="block text-[12px] font-medium text-[#5B6570] mb-2 font-mono tracking-wide">
              提問或心得
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="寫下今天讀到的一句話、一個疑問，或任何想法…"
              rows={4}
              className="w-full resize-none rounded-xl border border-[#D8D3C0] bg-white px-4 py-3 text-[14px] text-[#26323A] placeholder:text-[#B0AB98] focus:outline-none focus:ring-2 focus:ring-[#4C7A5D]/40 focus:border-[#4C7A5D] transition mb-2"
            />
            {submitError && (
              <p className="text-[12.5px] text-[#B33A2E] mb-2">{submitError}</p>
            )}
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl py-3 text-[15px] font-medium tracking-wide transition
                bg-[#B33A2E] text-[#FBF3EE] hover:bg-[#9C3126] active:scale-[0.99]
                disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 size={17} className="animate-spin" />
                  蓋章中…
                </>
              ) : (
                <>
                  <Stamp size={17} />
                  我要打卡
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StampSeal() {
  return (
    <div
      className="relative w-24 h-24 rounded-2xl border-[3px] border-[#B33A2E] flex items-center justify-center text-[#B33A2E] rotate-[-8deg]"
      style={{ fontFamily: "'Noto Serif TC', serif" }}
    >
      <div className="absolute inset-1 border border-[#B33A2E]/50 rounded-xl" />
      <span className="text-[15px] font-bold leading-tight text-center">
        已
        <br />
        打卡
      </span>
    </div>
  );
}

function SearchableMemberSelect({ members, value, onChange }) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // 外部 value 變動時（例如自動帶入上次記住的名字），同步到搜尋框文字
  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  // 點擊元件外面時收起下拉選單
  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.toLowerCase().includes(q));
  }, [members, query]);

  function selectMember(name) {
    onChange(name);
    setQuery(name);
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight]) selectMember(filtered[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative mb-5">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => {
            setOpen(true);
            setHighlight(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
            if (e.target.value !== value) onChange(""); // 打字時清空已確定的選擇，直到重新點選
          }}
          onKeyDown={handleKeyDown}
          placeholder="輸入姓名的一部分來搜尋…"
          className="w-full appearance-none rounded-xl border border-[#D8D3C0] bg-white px-4 py-3 pr-10 text-[15px] text-[#26323A] placeholder:text-[#B0AB98] focus:outline-none focus:ring-2 focus:ring-[#4C7A5D]/40 focus:border-[#4C7A5D] transition"
        />
        <ChevronDown
          size={18}
          className={`pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8A6A3A] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </div>

      {open && (
        <div className="absolute z-10 mt-1.5 w-full max-h-56 overflow-y-auto rounded-xl border border-[#D8D3C0] bg-white shadow-[0_10px_24px_-10px_rgba(38,50,58,0.3)]">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-[13px] text-[#9A9585]">
              找不到符合的名字
            </div>
          ) : (
            filtered.map((m, i) => (
              <button
                key={m}
                type="button"
                onMouseDown={(e) => e.preventDefault()} // 避免 input 先觸發 blur 關閉選單
                onClick={() => selectMember(m)}
                className={`w-full text-left px-4 py-2.5 text-[14px] transition ${
                  i === highlight
                    ? "bg-[#F0EEDF] text-[#26323A]"
                    : "text-[#26323A] hover:bg-[#F5F4EB]"
                } ${m === value ? "font-medium" : ""}`}
              >
                {m}
                {m === value && (
                  <Check
                    size={14}
                    className="inline-block ml-2 -mt-0.5 text-[#4C7A5D]"
                  />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FontsAndKeyframes() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@600;700&family=Noto+Sans+TC:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap');
      * { font-family: 'Noto Sans TC', 'IBM Plex Mono', sans-serif; }
      @keyframes stampIn {
        0% { opacity: 0; transform: scale(2) rotate(-25deg); }
        60% { opacity: 1; transform: scale(0.92) rotate(-6deg); }
        100% { opacity: 1; transform: scale(1) rotate(-8deg); }
      }
      @keyframes sheetIn {
        0% { opacity: 0; transform: translateY(24px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @keyframes fadeIn {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
      @keyframes toastIn {
        0% { opacity: 0; transform: translateY(10px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      .line-clamp-2 {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
    `}</style>
  );
}
