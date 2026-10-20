<script setup lang="ts">
import { computed } from "vue";
import { state, setPeriod } from "../state";
import { t } from "../core/i18n";
import { fmtHM, isNum, clamp } from "../core/math";

const r = computed(() => state.result);

const verdict = computed(() => {
  const g = r.value?.grade;
  if (!g) return { key: "加载中", cls: "" };
  if (g === "优" || g === "良") return { key: "值得出门", cls: "" };
  if (g === "一般") return { key: "谨慎出门", cls: "p-coral" };
  return { key: "今晚算了", cls: "p-mute" };
});

const pct = computed(() => {
  const x = r.value;
  if (!x) return "—";
  return String(Math.round(clamp((x.P + x.Q) / 2, 0, 100)));
});

const why = computed(() => {
  const x = r.value;
  if (!x) return t("正在取数");
  const deck = x.sRT.primary;
  const dur = isNum(x.dur) && x.dur > 0 ? Math.round(x.dur) : 8;
  return t("主云盘 {ty}，云量 {cv}%，火烧窗口约 {d} 分钟；{ev}方位 {az}。", {
    ty: deck.type, cv: Math.round(deck.cover), d: dur, ev: x.evName, az: Math.round(x.evAz) + "°"
  });
});

const when = computed(() => {
  const x = r.value;
  if (!x) return null;
  const ms = x.evMs - state.nowMs;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const cd = ms >= 0
    ? (h > 0 ? `${h}${t("小时后")} ${m}${t("分钟")}` : `${m}${t("分钟后")}`)
    : t("已过");
  return { ev: x.evName, hm: fmtHM(new Date(x.evMs).getHours() + new Date(x.evMs).getMinutes() / 60), cd };
});

const arrive = computed(() => {
  const s = state.spots[0];
  if (!s) return null;
  const d = new Date(s.arriveBy);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
});
</script>

<template>
  <section id="concl" class="concl">
    <div class="wrap concl-in">
      <div class="concl-verdict" :class="verdict.cls">
        {{ t(verdict.key) }}
        <span class="pct">{{ pct }}%</span>
      </div>

      <div class="concl-why">
        {{ why }}
        <div style="margin-top: 8px">
          <div class="seg" role="group" :aria-label="t('切换时段')">
            <button :class="{ on: state.period === 'pm' }" @click="setPeriod('pm')">{{ t("晚霞时段") }}</button>
            <button :class="{ on: state.period === 'am' }" @click="setPeriod('am')">{{ t("朝霞时段") }}</button>
          </div>
        </div>
      </div>

      <div class="concl-when" v-if="when">
        <b>{{ t(when.ev) }}</b> {{ when.hm }}<br>
        <span class="cd">{{ t("距窗口") }} {{ when.cd }}</span><br>
        <template v-if="arrive">
          <b>{{ t("到位建议") }}</b> {{ arrive }}
        </template>
      </div>
    </div>
  </section>
</template>
