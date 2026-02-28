import { Flex, Grid, Text } from "@chakra-ui/react";
import { Bot, Network, Cpu, Zap } from "lucide-react";
import { motion } from "framer-motion";

const FeatureFooter = () => {
  const features = [
    { icon: Bot, label: "多模型试验", chakraColor: "blue.600", chakraBg: "blue.50" },
    { icon: Network, label: "提示词工坊", chakraColor: "green.600", chakraBg: "green.50" },
    { icon: Cpu, label: "数据评测", chakraColor: "purple.600", chakraBg: "purple.50" },
    { icon: Zap, label: "一键发布", chakraColor: "red.600", chakraBg: "red.50" },
  ];

  return (
    <Grid templateColumns="repeat(4, 1fr)" gap={3} w="full">
      {features.map((feature, index) => (
        <FeatureItem key={index} feature={feature} delay={0.5 + index * 0.1} />
      ))}
    </Grid>
  );
};

const FeatureItem = ({ feature, delay }: { feature: any; delay: number }) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.5 }}
    style={{ height: "100%" }}
  >
    <Flex
      direction="column"
      align="center"
      justify="center"
      p={3}
      borderRadius="xl"
      border="1px solid transparent"
      bg={feature.chakraBg}
      _hover={{
        bg: `${feature.chakraBg}`,
        opacity: 1,
        borderColor: "gray.200",
      }}
      transition="all 0.2s"
      cursor="default"
      role="group"
      h="full"
    >
      <Flex
        mb={2}
        p={2}
        borderRadius="full"
        bg="white"
        boxShadow="sm"
        color={feature.chakraColor}
        _groupHover={{ transform: "scale(1.1)" }}
        transition="transform 0.2s"
      >
        <feature.icon size={20} />
      </Flex>
      <Text fontSize="xs" fontWeight="bold" color="gray.700" textAlign="center" lineHeight="1.4">
        {feature.label}
      </Text>
    </Flex>
  </motion.div>
);

export default FeatureFooter;
