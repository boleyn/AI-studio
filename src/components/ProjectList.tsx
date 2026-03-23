import { useEffect, useMemo, useState } from "react";
import { Rocket, Sparkles, Wand2 } from "lucide-react";
import {
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  CircularProgress,
  CircularProgressLabel,
  Divider,
  Flex,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Grid,
  Heading,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Spinner,
  Tab,
  TabList,
  Tabs,
  Text,
  Textarea,
} from "@chakra-ui/react";

import { AddIcon, EmptyIcon, LogoIcon, SearchIcon } from "./common/Icon";
import DashboardEntityCard from "./cards/DashboardEntityCard";
import { UserAccountMenu } from "./UserAccountMenu";
import VectorBackground from "./auth/VectorBackground";
import { useAuth } from "../contexts/AuthContext";
import { useProjects } from "../hooks/useProjects";
import { useSkills } from "../hooks/useSkills";
import { useDashboardOverview } from "../hooks/useDashboardOverview";

type HomeTab = "projects" | "skills";
type CreateType = "project" | "skill";

export default function ProjectList() {
  const { user, loading: loadingUser } = useAuth();
  const {
    projects,
    loading: loadingProjects,
    creating: creatingProject,
    createProject,
    openProject,
    renameProject,
    deleteProject,
    duplicateProject,
    formatDate,
  } = useProjects();
  const {
    skills,
    loading: loadingSkills,
    creating: creatingSkill,
    createSkill,
    openSkill,
    updateSkill,
    deleteSkill,
    duplicateSkill,
  } = useSkills();
  const { overview } = useDashboardOverview();

  const [activeTab, setActiveTab] = useState<HomeTab>("projects");
  const [searchValue, setSearchValue] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState<CreateType>("project");
  const [nameInput, setNameInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [projectFileCountMap, setProjectFileCountMap] = useState<Record<string, number>>({});

  const keyword = searchValue.trim().toLowerCase();
  const filteredProjects = useMemo(() => {
    if (!keyword) return projects;
    return projects.filter((item) => item.name.toLowerCase().includes(keyword));
  }, [keyword, projects]);
  const filteredSkills = useMemo(() => {
    if (!keyword) return skills;
    return skills.filter((item) => {
      return (
        item.name.toLowerCase().includes(keyword) ||
        item.description.toLowerCase().includes(keyword)
      );
    });
  }, [keyword, skills]);

  const creating = creatingProject || creatingSkill;
  const projectTotal = overview.projects.total;
  const projectAddedThisMonth = overview.projects.addedThisMonth;
  const publishedSkills = overview.skills.published;
  const pendingSkills = overview.skills.pending;
  const publishedRate = overview.skills.publishedRate;
  const totalSessions = overview.sessions.totalSessions;
  const totalMessages = overview.sessions.totalMessages;
  const avgMessagesPerSession = overview.sessions.avgMessagesPerSession;

  const formatCompactNumber = (value: number) => {
    if (!Number.isFinite(value)) return "0";
    if (value >= 1000) {
      const formatted = (value / 1000).toFixed(value % 1000 === 0 ? 0 : 1);
      return `${formatted}k`;
    }
    return value.toLocaleString("zh-CN");
  };

  const formatAbsoluteDate = (dateString?: string) => {
    if (!dateString) return "--";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "--";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  useEffect(() => {
    const missingTokens = projects
      .map((item) => item.token)
      .filter((token) => projectFileCountMap[token] === undefined);
    if (missingTokens.length === 0) return;

    let cancelled = false;
    const fetchFileCounts = async () => {
      const pairs = await Promise.all(
        missingTokens.map(async (token) => {
          try {
            const response = await fetch(`/api/code?token=${encodeURIComponent(token)}`);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload || typeof payload !== "object") return [token, 0] as const;
            const files = (payload as { files?: Record<string, { code: string }> }).files;
            const count = files && typeof files === "object" ? Object.keys(files).length : 0;
            return [token, count] as const;
          } catch {
            return [token, 0] as const;
          }
        })
      );
      if (cancelled) return;
      setProjectFileCountMap((prev) => {
        const next = { ...prev };
        pairs.forEach(([token, count]) => {
          next[token] = count;
        });
        return next;
      });
    };
    void fetchFileCounts();

    return () => {
      cancelled = true;
    };
  }, [projects, projectFileCountMap]);

  const resetCreateModal = () => {
    setNameInput("");
    setDescriptionInput("");
    setCreateType(activeTab === "skills" ? "skill" : "project");
  };

  const handleOpenCreateModal = () => {
    resetCreateModal();
    setCreateModalOpen(true);
  };
  const handleCloseCreateModal = () => {
    setCreateModalOpen(false);
    resetCreateModal();
  };

  const handleCreate = async () => {
    const name = nameInput.trim();
    if (!name) return;

    if (createType === "project") {
      await createProject(name, descriptionInput.trim() || undefined);
      handleCloseCreateModal();
      return;
    }

    if (createType === "skill") {
      const created = await createSkill({
        sourceType: "custom",
        name,
        description: descriptionInput.trim() || undefined,
      });
      if (created) {
        handleCloseCreateModal();
      }
    } else {
      return;
    }
  };

  const currentLoading = activeTab === "projects" ? loadingProjects : loadingSkills;
  const isProjectsTab = activeTab === "projects";
  const navActiveStyles = {
    bg: "myGray.100",
    border: "1px solid rgba(148,163,184,0.55)",
    color: "myGray.800",
    fontWeight: "semibold",
  } as const;
  const navInactiveStyles = {
    bg: "transparent",
    border: "1px solid transparent",
    color: "myGray.700",
    fontWeight: "medium",
  } as const;

  const isNameInvalid = createType === "skill" && nameInput.trim() !== "" && !/^[\w\-\s]+$/.test(nameInput);

  return (
    <Box position="relative" minH="100vh" overflow="hidden">
      <VectorBackground />
      <Flex
        direction="column"
        minH="100vh"
        align="stretch"
        justify="flex-start"
        px={{ base: 4, md: 8, xl: 10 }}
        py={{ base: 6, md: 8 }}
        position="relative"
        zIndex={1}
      >
        <Flex direction={{ base: "column", lg: "row" }} flex="1" minH="0" align="stretch" gap={{ base: 6, lg: 0 }}>
          <Box
            w={{ base: "100%", lg: "300px" }}
            bg="var(--ws-surface)"
            borderTopLeftRadius="2xl"
            borderTopRightRadius={{ base: "2xl", lg: 0 }}
            borderBottomRightRadius={{ base: 0, lg: 0 }}
            borderBottomLeftRadius={{ base: 0, lg: "2xl" }}
            border="1px solid var(--ws-border)"
            px={{ base: 5, md: 6 }}
            py={{ base: 6, md: 7 }}
            backdropFilter="blur(18px)"
            minH={{ base: "auto", lg: "100%" }}
            display="flex"
          >
            <Flex direction="column" h="100%" gap={6} flex="1">
              <Flex align="center" justify="space-between">
                <HStack spacing={3}>
                  <Box as={LogoIcon} w={7} h={7} flexShrink={0} />
                  <Box>
                    <Heading size="sm" color="myGray.800">
                      AI Studio
                    </Heading>
                    <Text fontSize="xs" color="myGray.500">
                      MODEL LAB
                    </Text>
                  </Box>
                </HStack>
                <Badge fontSize="0.6rem" colorScheme="green" variant="subtle" borderRadius="full" px={2}>
                  LIVE
                </Badge>
              </Flex>

              <Box>
                <Text fontSize="xs" color="myGray.500" mb={3} textTransform="uppercase" letterSpacing="wider">
                  工作台
                </Text>
                <Flex direction="column" gap={2}>
                  <Button
                    variant="ghost"
                    justifyContent="flex-start"
                    borderRadius="md"
                    {...(isProjectsTab ? navActiveStyles : navInactiveStyles)}
                    _hover={{ bg: "myGray.150", borderColor: "rgba(148,163,184,0.5)" }}
                    onClick={() => setActiveTab("projects")}
                  >
                    我的项目
                  </Button>
                  <Button
                    variant="ghost"
                    justifyContent="flex-start"
                    borderRadius="md"
                    {...(!isProjectsTab ? navActiveStyles : navInactiveStyles)}
                    _hover={{ bg: "myGray.150", borderColor: "rgba(148,163,184,0.5)" }}
                    onClick={() => setActiveTab("skills")}
                  >
                     SKILLS
                  </Button>
                  <Button
                    variant="ghost"
                    justifyContent="flex-start"
                    borderRadius="md"
                    onClick={handleOpenCreateModal}
                    isLoading={creating}
                    leftIcon={<Box as={AddIcon} w={4} h={4} />}
                    iconSpacing={2.5}
                    fontWeight="medium"
                    color="primary.700"
                    _hover={{ bg: "myGray.100" }}
                  >
                    新增
                  </Button>
                </Flex>
              </Box>

              <Divider borderColor="var(--ws-border)" />

              <UserAccountMenu user={user} loadingUser={loadingUser} />
            </Flex>
          </Box>

          <Box
            flex={1}
            px={{ base: 5, md: 8, lg: 10 }}
            py={{ base: 6, md: 8 }}
            bg="var(--ws-surface)"
            border="1px solid var(--ws-border)"
            borderLeft={{ base: "1px solid var(--ws-border)", lg: "none" }}
            borderTopLeftRadius={{ base: 0, lg: 0 }}
            borderTopRightRadius={{ base: 0, lg: "2xl" }}
            borderBottomRightRadius="2xl"
            borderBottomLeftRadius={{ base: "2xl", lg: 0 }}
            backdropFilter="blur(22px)"
          >
            <Flex
              align={{ base: "flex-start", lg: "center" }}
              justify="space-between"
              direction={{ base: "column", lg: "row" }}
              gap={4}
              mb={6}
            >
              <Box>
                <Heading size="md" mb={2} color="myGray.800" lineHeight="1.2">
                  工作台首页
                </Heading>
                <Text color="myGray.600">
                  统一管理项目与技能，快速切换并继续你的工作流。
                </Text>
              </Box>
              <HStack spacing={3} w={{ base: "100%", lg: "auto" }}>
                <Box position="relative" w={{ base: "100%", lg: "320px" }}>
                  <Box as={SearchIcon} w={4} h={4} position="absolute" left={3} top="50%" transform="translateY(-50%)" color="myGray.500" />
                  <Input
                    pl={9}
                    placeholder={isProjectsTab ? "搜索项目名称" : "搜索 skill 名称或描述"}
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    bg="myWhite.100"
                    borderColor="myGray.200"
                    _hover={{ borderColor: "myGray.300" }}
                    _focusVisible={{ borderColor: "primary.400", boxShadow: "0 0 0 1px var(--chakra-colors-primary-400)" }}
                    name="project_search_keyword"
                    autoComplete="off"
                  />
                </Box>
                <Button
                  variant="whitePrimary"
                  onClick={handleOpenCreateModal}
                  isLoading={creating}
                  leftIcon={<Box as={AddIcon} w={4} h={4} />}
                >
                  新增
                </Button>
              </HStack>
            </Flex>

            <Box mb={8}>
              <Grid templateColumns={{ base: "1fr", lg: "repeat(3, minmax(0, 1fr))" }} gap={5}>
                {/* 1. 活跃指标 */}
                <Card
                  borderRadius="2xl"
                  border="1px solid var(--ws-border)"
                  bg="var(--ws-surface)"
                  boxShadow="sm"
                  h={{ base: "auto", lg: "145px" }}
                  overflow="hidden"
                  position="relative"
                >
                  <CardBody py={4} px={5} h="full" display="flex" flexDirection="column" justifyContent="space-between">
                    <Flex justify="space-between" align="center" mb={2}>
                      <Text fontSize="14px" color="myGray.800" fontWeight="bold">
                        项目活跃指数
                      </Text>
                      <Badge bg="primary.50" color="primary.600" px={2} py={1} borderRadius="md" fontSize="10px" border="1px solid" borderColor="primary.200">
                        本月新增 {projectAddedThisMonth}
                      </Badge>
                    </Flex>
                    <Flex align="flex-end" justify="space-between" gap={3} mt="auto">
                      <Box minW={0}>
                        <Text fontSize="12px" color="myGray.500" mb={1}>总项目数</Text>
                        <Heading fontSize={{ base: "44px", lg: "48px" }} color="primary.500" lineHeight="1" letterSpacing="-0.02em">
                          {projectTotal.toLocaleString("zh-CN")}
                        </Heading>
                      </Box>
                      <Flex w="46px" h="46px" borderRadius="xl" bg="primary.50" align="center" justify="center" mb={1} border="1px solid" borderColor="primary.100" color="primary.500">
                        <Sparkles size={24} strokeWidth={1.5} />
                      </Flex>
                    </Flex>
                  </CardBody>
                </Card>

                {/* 2. 技能发布 */}
                <Card
                  borderRadius="2xl"
                  border="1px solid var(--ws-border)"
                  bg="var(--ws-surface)"
                  boxShadow="sm"
                  h={{ base: "auto", lg: "145px" }}
                  overflow="hidden"
                >
                  <CardBody py={4} px={5} h="full" display="flex" flexDirection="column" justifyContent="space-between">
                    <Text fontSize="14px" color="myGray.800" fontWeight="bold" mb={2}>
                      SKILLS
                    </Text>
                    <Flex align="center" justify="space-between" gap={4} flex="1">
                      <CircularProgress
                        value={publishedRate}
                        color="primary.400"
                        size="68px"
                        thickness="10px"
                        trackColor="myGray.100"
                      >
                        <CircularProgressLabel>
                          <Text fontWeight="bold" fontSize="md">
                            {publishedRate}%
                          </Text>
                        </CircularProgressLabel>
                      </CircularProgress>
                      <Flex direction="column" justify="center" gap={3} flex="1">
                        <Flex justify="space-between" align="center">
                          <HStack spacing={2}>
                            <Box w={2.5} h={2.5} borderRadius="sm" bg="primary.400" />
                            <Text fontSize="12px" color="myGray.600">已发布</Text>
                          </HStack>
                          <Text fontSize="16px" fontWeight="bold" color="myGray.800">
                            {publishedSkills.toLocaleString("zh-CN")}
                          </Text>
                        </Flex>
                        <Flex justify="space-between" align="center">
                          <HStack spacing={2}>
                            <Box w={2.5} h={2.5} borderRadius="sm" bg="myGray.200" />
                            <Text fontSize="12px" color="myGray.600">待发布</Text>
                          </HStack>
                          <Text fontSize="16px" fontWeight="bold" color="myGray.600">
                            {pendingSkills.toLocaleString("zh-CN")}
                          </Text>
                        </Flex>
                      </Flex>
                    </Flex>
                  </CardBody>
                </Card>

                {/* 3. 交互会话 */}
                <Card
                  borderRadius="2xl"
                  border="1px solid var(--ws-border)"
                  bg="var(--ws-surface)"
                  boxShadow="sm"
                  h={{ base: "auto", lg: "145px" }}
                  overflow="hidden"
                  position="relative"
                >
                  <CardBody py={4} px={5} h="full" display="flex" flexDirection="column" justifyContent="space-between">
                    <Flex justify="space-between" align="center" mb={1}>
                      <Text fontSize="14px" color="myGray.800" fontWeight="bold">
                        交互会话概览
                      </Text>
                      <Badge bg="primary.50" color="primary.600" px={2} py={1} borderRadius="md" fontSize="10px" border="1px solid" borderColor="primary.200">
                        {Number.isFinite(avgMessagesPerSession) ? avgMessagesPerSession.toFixed(1) : "0.0"} / 会话
                      </Badge>
                    </Flex>
                    <Grid templateColumns="1fr 1fr" gap={4} mt={3}>
                      <Box p={3} bg="myGray.50" borderRadius="xl" border="1px solid" borderColor="myGray.100" transition="all 0.2s" _hover={{ bg: "myGray.100" }}>
                        <Text fontSize="11px" color="myGray.500" mb={1}>
                          总会话数
                        </Text>
                        <Text fontSize={{ base: "20px", lg: "22px" }} lineHeight="1" fontWeight="bold" color="myGray.800">
                          {totalSessions.toLocaleString("zh-CN")}
                        </Text>
                      </Box>
                      <Box p={3} bg="myGray.50" borderRadius="xl" border="1px solid" borderColor="myGray.100" transition="all 0.2s" _hover={{ bg: "myGray.100" }}>
                        <Text fontSize="11px" color="myGray.500" mb={1}>
                          消息总量
                        </Text>
                        <Text fontSize={{ base: "20px", lg: "22px" }} lineHeight="1" fontWeight="bold" color="myGray.800">
                          {formatCompactNumber(totalMessages)}
                        </Text>
                      </Box>
                    </Grid>
                  </CardBody>
                </Card>
              </Grid>
            </Box>

            <Box mb={6} maxW="max-content">
              <Tabs variant="unstyled" index={isProjectsTab ? 0 : 1} onChange={(index) => setActiveTab(index === 0 ? "projects" : "skills")}>
                <TabList bg="myGray.50" p={1.5} borderRadius="14px" border="1px solid" borderColor="myGray.150" gap={1}>
                  <Tab
                    fontWeight="600"
                    fontSize="sm"
                    color="myGray.500"
                    borderRadius="10px"
                    px={5}
                    py={1.5}
                    _selected={{ color: "primary.600", bg: "white", boxShadow: "0 2px 8px -2px rgba(15, 23, 42, 0.08)", borderColor: "myGray.200" }}
                    _hover={{ color: !isProjectsTab ? "myGray.800" : undefined }}
                    border="1px solid transparent"
                    transition="all 0.2s"
                  >
                    项目
                    <Box as="span" ml={1.5} opacity={0.8} fontWeight="normal">
                      ({projects.length})
                    </Box>
                  </Tab>
                  <Tab
                    fontWeight="600"
                    fontSize="sm"
                    color="myGray.500"
                    borderRadius="10px"
                    px={5}
                    py={1.5}
                    _selected={{ color: "primary.600", bg: "white", boxShadow: "0 2px 8px -2px rgba(15, 23, 42, 0.08)", borderColor: "myGray.200" }}
                    _hover={{ color: isProjectsTab ? "myGray.800" : undefined }}
                    border="1px solid transparent"
                    transition="all 0.2s"
                  >
                    Skills
                    <Box as="span" ml={1.5} opacity={0.8} fontWeight="normal">
                      ({skills.length})
                    </Box>
                  </Tab>
                </TabList>
              </Tabs>
            </Box>

            {currentLoading ? (
              <Flex justify="center" align="center" minH="320px">
                <Spinner size="xl" />
              </Flex>
            ) : isProjectsTab ? (
              filteredProjects.length === 0 ? (
                <Flex
                  direction="column"
                  align="center"
                  justify="center"
                  py={{ base: 16, lg: 20 }}
                  bg="var(--ws-surface)"
                  borderRadius="2xl"
                  border="1px solid"
                  borderColor="myGray.200"
                  boxShadow="sm"
                >
                  <Box mb={6}>
                    <Box as={EmptyIcon} w="184px" h="152px" />
                  </Box>
                  <Heading size="md" color="myGray.800" mb={3}>
                    {searchValue ? "没有匹配的项目" : "启动你的第一个项目"}
                  </Heading>
                  <Text color="myGray.500" mb={8} maxW="md" textAlign="center" fontSize="sm">
                    {searchValue ? "未发现匹配该搜索词的项目。尝试换一个词或者新建项目。" : "在这里管理你的所有 AI 探索与应用开发。创建一个新项目，开始与模型进行深度对话。"}
                  </Text>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleOpenCreateModal}
                    isLoading={creating}
                    leftIcon={<Box as={AddIcon} w={5} h={5} />}
                    transition="all 0.2s"
                  >
                    新建项目
                  </Button>
                </Flex>
              ) : (
                <Grid
                  templateColumns={{
                    base: "1fr",
                    md: "repeat(2, minmax(0, 1fr))",
                    xl: "repeat(3, minmax(0, 1fr))",
                    "2xl": "repeat(4, minmax(0, 1fr))",
                  }}
                  gap={4}
                >
                  {filteredProjects.map((project, index) => {
                    return (
                    <DashboardEntityCard
                      key={project.token}
                      index={index}
                      title={project.name}
                      description={project.description || "继续编辑项目代码与相关对话"}
                      createdMeta={formatAbsoluteDate(project.createdAt)}
                      meta={`更新于 ${formatDate(project.updatedAt)}`}
                      fileCount={projectFileCountMap[project.token]}
                      onOpen={() => openProject(project.token)}
                      onRename={(nextName, nextDesc) => renameProject(project.token, nextName, nextDesc)}
                      renameDialogTitle="修改项目"
                      renameFieldLabel="项目名称"
                      renamePlaceholder="输入项目名称"
                      renameDescLabel="项目描述（非必填）"
                      renameDescPlaceholder="简单描述这个项目的作用..."
                      initialDescription={project.description}
                      onDelete={() => deleteProject(project.token)}
                      onDuplicate={() => duplicateProject(project.token)}
                      deleteDialogTitle="删除项目"
                      deleteDialogBody={`确定删除项目「${project.name}」吗？将同时删除该项目的所有对话记录和文件，此操作无法撤销。`}
                    />
                    );
                  })}
                </Grid>
              )
            ) : filteredSkills.length === 0 ? (
              <Flex
                direction="column"
                align="center"
                justify="center"
                py={{ base: 16, lg: 20 }}
                bg="var(--ws-surface)"
                borderRadius="2xl"
                border="1px solid"
                borderColor="myGray.200"
                boxShadow="sm"
              >
                <Box mb={6}>
                  <Box as={EmptyIcon} w="184px" h="152px" />
                </Box>
                <Heading size="md" color="myGray.800" mb={3}>
                  {searchValue ? "没有匹配的 Skill" : "沉淀你的专属 Skill"}
                </Heading>
                <Text color="myGray.500" mb={8} maxW="md" textAlign="center" fontSize="sm">
                  {searchValue ? "未发现匹配该搜索词的 Skill。尝试换一个词或者新建 Skill。" : "尚未发现任何满足条件的 Skill。你可以将常用的 Prompt 封装成 Skill，在任意项目中复用。"}
                </Text>
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleOpenCreateModal}
                  isLoading={creating}
                  leftIcon={<Box as={AddIcon} w={5} h={5} />}
                  transition="all 0.2s"
                >
                  新建 Skill
                </Button>
              </Flex>
            ) : (
              <Grid
                templateColumns={{
                  base: "1fr",
                  md: "repeat(2, minmax(0, 1fr))",
                  xl: "repeat(3, minmax(0, 1fr))",
                  "2xl": "repeat(4, minmax(0, 1fr))",
                }}
                gap={4}
              >
                {filteredSkills.map((skill, index) => {
                  return (
                  <DashboardEntityCard
                    key={skill.token}
                    index={index}
                    title={skill.name}
                    description={skill.description || "暂无描述"}
                    createdMeta={formatAbsoluteDate(skill.createdAt)}
                    meta={`更新于 ${formatDate(skill.updatedAt)}`}
                    fileCount={1}
                    onOpen={() => {
                      void openSkill(skill.token);
                    }}
                    onRename={async (nextName, nextDesc) => {
                      await updateSkill(skill.token, nextName, nextDesc);
                    }}
                    renameDialogTitle="修改 Skill"
                    renameFieldLabel="Skill 名称"
                    renamePlaceholder="输入 skill 名称"
                    renameDescLabel="触发描述（非必填）"
                    renameDescPlaceholder="描述这个 skill 适合在什么场景触发"
                    renameNameRegex={/^[\w\-\s]+$/}
                    renameNameErrorMsg="Skill 名称仅支持英文字母、数字、空格、横线（-）和下划线（_）"
                    initialDescription={skill.description}
                    onDuplicate={async () => {
                      await duplicateSkill(skill.token);
                    }}
                    onDelete={async () => {
                      await deleteSkill(skill.token);
                    }}
                    deleteDialogTitle="删除 Skill"
                    deleteDialogBody={`确定删除 Skill「${skill.name}」吗？该操作不可撤销。`}
                  />
                  );
                })}
              </Grid>
            )}
          </Box>
        </Flex>
      </Flex>

      <Modal isOpen={createModalOpen} onClose={handleCloseCreateModal} isCentered size="md">
        <ModalOverlay bg="blackAlpha.400" />
        <ModalContent borderRadius="xl" border="1px solid rgba(255,255,255,0.65)" bg="rgba(255,255,255,0.92)" backdropFilter="blur(18px)">
          <ModalHeader color="myGray.800">新增</ModalHeader>
          <ModalBody>
            <FormControl isRequired mb={4}>
              <FormLabel color="myGray.700">类型</FormLabel>
              <Select value={createType} onChange={(event) => setCreateType(event.target.value as CreateType)}>
                <option value="project">项目</option>
                <option value="skill">Skill</option>
              </Select>
            </FormControl>

            <FormControl isRequired isInvalid={isNameInvalid} mb={4}>
              <FormLabel color="myGray.700">{createType === "project" ? "项目名称" : "Skill 名称"}</FormLabel>
              <Input
                placeholder={createType === "project" ? "输入项目名称" : "输入 skill 名称"}
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isNameInvalid) {
                    void handleCreate();
                  }
                }}
                autoFocus
                bg="myWhite.100"
                borderColor="myGray.200"
                _hover={{ borderColor: "myGray.300" }}
                _focusVisible={{ borderColor: "primary.400", boxShadow: "0 0 0 1px var(--chakra-colors-primary-400)" }}
                name="new_entity_name"
                autoComplete="off"
              />
              <FormErrorMessage>Skill 名称仅支持英文字母、数字、空格、横线（-）和下划线（_）</FormErrorMessage>
            </FormControl>

            <FormControl mb={0}>
              <FormLabel color="myGray.700">
                {createType === "project" ? "项目描述（非必填）" : "触发描述（非必填）"}
              </FormLabel>
              <Textarea
                placeholder={createType === "project" ? "简单描述这个项目的作用..." : "描述这个 skill 适合在什么场景触发"}
                value={descriptionInput}
                onChange={(event) => setDescriptionInput(event.target.value)}
                bg="myWhite.100"
                borderColor="myGray.200"
                _hover={{ borderColor: "myGray.300" }}
                _focusVisible={{ borderColor: "primary.400", boxShadow: "0 0 0 1px var(--chakra-colors-primary-400)" }}
                name="new_entity_desc"
                rows={3}
                resize="vertical"
              />
            </FormControl>
          </ModalBody>
          <ModalFooter gap={2}>
            <Button variant="ghost" onClick={handleCloseCreateModal}>
              取消
            </Button>
            <Button
              variant="whitePrimary"
              onClick={() => {
                void handleCreate();
              }}
              isLoading={creating}
              isDisabled={!nameInput.trim() || isNameInvalid}
            >
              创建
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
