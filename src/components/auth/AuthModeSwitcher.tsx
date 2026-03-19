import { Box, Button, SimpleGrid } from "@chakra-ui/react";
import { motion } from "framer-motion";
import Avatar from "./Avatar";
import { LoginPageTypeEnum } from "./constants";

type SwitcherOption = {
  label: string;
  icon: string;
  pageType: LoginPageTypeEnum;
};

type AuthModeSwitcherProps = {
  options: SwitcherOption[];
  currentPageType: LoginPageTypeEnum;
  onChange: (pageType: LoginPageTypeEnum) => void;
};

const AuthModeSwitcher = ({ options, currentPageType, onChange }: AuthModeSwitcherProps) => {
  const singleModeWidth = "calc((100% - 12px) / 2)";

  if (options.length === 1) {
    const item = options[0];
    const active = item.pageType === currentPageType;

    return (
      <Box w="100%" display="flex" justifyContent="center">
        <motion.div
          key={item.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          style={{ width: singleModeWidth }}
        >
          <Button
            variant="whitePrimary"
            w="100%"
            h="44px"
            minH="44px"
            fontSize="sm"
            lineHeight="1"
            borderRadius="12px"
            fontWeight="medium"
            leftIcon={<Avatar src={item.icon} w="20px" />}
            borderColor={active ? "primary.300" : "myGray.250"}
            bg={active ? "rgba(240, 244, 255, 0.92)" : "rgba(255,255,255,0.94)"}
            color={active ? "primary.700" : "myGray.600"}
            boxShadow={active ? "0 10px 24px -20px rgba(37, 99, 235, 0.58)" : undefined}
            onClick={() => onChange(item.pageType)}
          >
            {item.label}
          </Button>
        </motion.div>
      </Box>
    );
  }

  return (
    <SimpleGrid columns={2} spacing={3}>
      {options.map((item, index) => {
        const active = item.pageType === currentPageType;
        return (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.28, ease: "easeOut" }}
          >
            <Button
              variant="whitePrimary"
              w="100%"
              h="44px"
              minH="44px"
              fontSize="sm"
              lineHeight="1"
              borderRadius="12px"
              fontWeight="medium"
              leftIcon={<Avatar src={item.icon} w="20px" />}
              borderColor={active ? "primary.300" : "myGray.250"}
              bg={active ? "rgba(240, 244, 255, 0.92)" : "rgba(255,255,255,0.94)"}
              color={active ? "primary.700" : "myGray.600"}
              boxShadow={active ? "0 10px 24px -20px rgba(37, 99, 235, 0.58)" : undefined}
              onClick={() => onChange(item.pageType)}
            >
              {item.label}
            </Button>
          </motion.div>
        );
      })}
    </SimpleGrid>
  );
};

export default AuthModeSwitcher;
