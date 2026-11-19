import { Box, Button, Flex, Heading, Input, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton, Select, Switch, Textarea, Text } from "@chakra-ui/react";
import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import type { Schedule } from "@/shared/schedules/types";
import { withAuthHeaders } from "@features/auth/client/authClient";

const labels = { active: "已启用", running: "执行中", paused: "已暂停", completed: "已完成" };

export default function SiteSchedules({ siteId, siteName }: { siteId: string; siteName: string }) {
  const [tasks, setTasks] = useState<Schedule[]>();
  const [context, setContext] = useState<{token:string; chats:{id:string; title:string}[]}>();
  const [draft, setDraft] = useState<string>();
  const [repeating, setRepeating] = useState(true);
  const [zone, setZone] = useState("UTC");
  const [firstTime, setFirstTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  function edit(title: string) {
    setSaveError("");
    setRepeating(true);
    const now = DateTime.local();
    setZone(now.zoneName || "UTC");
    const morning = now.startOf("day").set({hour:9});
    setFirstTime((morning > now ? morning : morning.plus({days:1})).toFormat("yyyy-MM-dd'T'HH:mm"));
    setDraft(title);
  }
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setTasks(undefined);
    async function load() {
      try {
        const response = await fetch("/api/schedules?" + new URLSearchParams({ siteId }), {
          headers: withAuthHeaders(), signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Array.isArray(data.tasks)) throw new Error();
        if (!controller.signal.aborted) {
          setTasks(data.tasks);
          setContext({ token: data.token, chats: data.chats });
        }
      } catch {
        if (!controller.signal.aborted) setError("无法加载已安排的任务，请稍后重试。");
      }
    }
    void load();
    return () => controller.abort();
  }, [siteId, attempt]);
  return <Box as="section" mt={6}>
    <Flex justify="space-between" align="center"><Heading as="h2" size="sm">已安排的任务</Heading>
      <Button size="sm" borderRadius="full" isDisabled={!tasks || draft !== undefined} onClick={()=>edit("")}>创建任务</Button></Flex>
    <Text mt={1} mb={4} fontSize="sm" color="gray.600">按设定的任务时间自动更新你的站点</Text>
    {draft !== undefined && context && <Modal isOpen isCentered scrollBehavior="inside" onClose={()=>{if (!saving) setDraft(undefined);}}>
      <ModalOverlay/><ModalContent mx={3} borderRadius="16px"><ModalHeader pr={12}>为 {siteName} 安排任务</ModalHeader>
      <ModalCloseButton aria-label="关闭对话框" isDisabled={saving}/><ModalBody><form key={draft} onSubmit={async event=>{
      event.preventDefault();
      if (saving) return;
      const form = new FormData(event.currentTarget);
      setSaving(true);
      setSaveError("");
      try {
        const localTime = form.get("date") + "T" + form.get("time");
        const start = DateTime.fromISO(localTime, {zone});
        if (!start.isValid || start.toFormat("yyyy-MM-dd'T'HH:mm") !== localTime) {
          throw new Error("这个时间在所选时区中不存在，请调整开始时间。");
        }
        const response = await fetch("/api/schedules", {method:"POST", headers:withAuthHeaders({"Content-Type":"application/json"}),
          body:JSON.stringify({action:"create", token:context.token, chatId:form.get("chatId"), spec:{
            title:form.get("title"), prompt:form.get("prompt"), repeat:repeating ? form.get("repeat") : "once",
            firstAt:start.toISO(), timezone:zone,
          }})});
        if (!response.ok) throw new Error((await response.json()).error || "创建任务失败");
        setDraft(undefined);
        setAttempt(n=>n+1);
      } catch(reason) { setSaveError(reason instanceof TypeError ? "连接失败，请重试。" : reason instanceof Error ? reason.message : "创建任务失败"); }
      finally { setSaving(false); }
    }}>
      <Flex as="fieldset" mb={5} disabled={saving} direction="column" gap={2}>
        <label>任务名称<Input name="title" defaultValue={draft} required maxLength={100}/></label>
        <label>任务说明<Textarea name="prompt" defaultValue={draft} required maxLength={4000}/></label>
        <label>关联对话<Select name="chatId" required>{context.chats.map(chat=><option key={chat.id} value={chat.id}>{chat.title}</option>)}</Select></label>
        {!context.chats.length && <Text fontSize="sm">请先在站点项目中保存一段对话。</Text>}
        <Flex align="center" justify="space-between"><label htmlFor="site-task-repeat">重复执行任务</label>
          <Switch id="site-task-repeat" isChecked={repeating} onChange={event=>setRepeating(event.target.checked)}/></Flex>
        <label hidden={!repeating}>频率<Select name="repeat" defaultValue="daily"><option value="daily">每天</option><option value="weekly">每周</option></Select></label>
        <label>{repeating ? "首次运行日期" : "日期"}<Input type="date" defaultValue={firstTime.split("T")[0]} name="date" required/></label>
        <label>{repeating ? "时间" : "开始时间"}<Input type="time" defaultValue={firstTime.split("T")[1]} name="time" required/></label>
        <details><summary>高级</summary>
          <label>时区<Select value={zone} onChange={event=>setZone(event.target.value)}>
            {[...new Set([Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC", ...(Intl.supportedValuesOf?.("timeZone") ?? [])])].map(name=><option key={name} value={name}>{name}</option>)}
          </Select></label>
        </details>
        {saveError && <Text role="alert">{saveError}</Text>}
        <Flex gap={2}><Button type="submit" size="sm" isLoading={saving} isDisabled={!context.chats.length}>保存任务</Button>
          <Button size="sm" onClick={()=>setDraft(undefined)}>取消</Button></Flex>
      </Flex>
    </form></ModalBody></ModalContent></Modal>}
    {error ? <Flex align="center" gap={2}><Text role="alert">{error}</Text><Button size="sm" onClick={() => setAttempt(n => n + 1)}>重试</Button></Flex>
      : !tasks ? <Text role="status">正在加载已安排的任务…</Text>
      : !tasks.length ? <Flex direction="column" align="start" gap={2}><Button size="sm" variant="ghost" onClick={()=>edit("")}>试用已安排的任务</Button>
          {["保持活动信息最新","刷新仪表板数据","进行促销活动"].map(title=><Button key={title} size="sm" variant="outline" isDisabled={draft !== undefined} onClick={()=>edit(title)}>{title}</Button>)}</Flex>
      : <Box as="ul" listStyleType="none">{tasks.map(task => <Box as="li" key={task._id} py={3} borderBottomWidth="1px">
        <Flex align="baseline" justify="space-between" gap={3}><Text overflowWrap="anywhere">{task.title}</Text><Text flexShrink={0} fontSize="sm">{labels[task.state]}</Text></Flex>
        {task.state === "active" && <Text fontSize="sm" color="gray.600">下次运行 {new Date(task.nextAt).toLocaleString("zh-CN", { timeZone: task.timezone, timeZoneName: "short" })}</Text>}
      </Box>)}</Box>}
  </Box>;
}
