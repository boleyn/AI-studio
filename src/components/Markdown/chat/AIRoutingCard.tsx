import React from 'react';
import { Box, Flex } from '@chakra-ui/react';
import { useTranslation } from 'next-i18next';
import MyIcon from '@/components/common/MyIcon';
import Avatar from '@/components/common/MyAvatar';

interface AIRoutingCardProps {
  text: string;
}

interface AIRoutingData {
  selectedApp?: string;
  reason?: string;
  appAvatar?: string;
  error?: string;
  isManualSelection?: boolean;
}

const AIRoutingCard: React.FC<AIRoutingCardProps> = ({ text }) => {
  const { t } = useTranslation();

  try {
    // Clean the text to handle potential extra content after JSON
    let cleanText = text.trim();

    // Try to find the JSON part if there's extra content
    const jsonStart = cleanText.indexOf('{');
    const jsonEnd = cleanText.lastIndexOf('}');

    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleanText = cleanText.substring(jsonStart, jsonEnd + 1);
    }

    // Additional cleanup: remove any trailing non-JSON content
    const lines = cleanText.split('\n');
    let jsonLines = [];
    let braceCount = 0;
    let foundStart = false;

    for (const line of lines) {
      if (!foundStart && line.trim().startsWith('{')) {
        foundStart = true;
      }

      if (foundStart) {
        jsonLines.push(line);
        braceCount += (line.match(/\{/g) || []).length;
        braceCount -= (line.match(/\}/g) || []).length;

        if (braceCount === 0) {
          break;
        }
      }
    }

    if (jsonLines.length > 0) {
      cleanText = jsonLines.join('\n');
    }

    const data: AIRoutingData = JSON.parse(cleanText);

    // Validate that we have a proper object
    if (!data || typeof data !== 'object') {
      throw new Error('Parsed data is not a valid object');
    }

    const selectedApp = data.selectedApp || t('dashboard_entries:unknown_app_fallback');
    const reasonText = data.isManualSelection
      ? t('dashboard_entries:manual_selection')
      : t('dashboard_entries:intelligent_routing');

    if (!selectedApp || selectedApp === t('dashboard_entries:unknown_app_fallback')) return null;

    const isError = !!data.error;

    return (
      <Box
        mb={1.5}
        position={'relative'}
        minW={{ base: '320px', md: '500px' }}
        maxW={'100%'}
        w={'100%'}
      >
        <Box
          bg={'transparent'}
          borderRadius={'lg'}
          overflow={'hidden'}
          border={'1px solid'}
          borderColor={isError ? 'red.200' : 'green.200'}
          _hover={{
            borderColor: isError ? 'red.300' : 'green.300'
          }}
          w={'100%'}
        >
          {/* AI Routing Watermark - Bottom Right */}
          <Box
            position={'absolute'}
            right={2}
            zIndex={10}
            opacity={0.6}
            _hover={{ opacity: 0.9 }}
            transition={'opacity 0.2s ease'}
            bg={'rgba(255, 255, 255, 0.8)'}
            backdropFilter={'blur(4px)'}
            borderRadius={'md'}
            px={3}
            py={1.5}
          >
            <Flex align={'center'}>
              <MyIcon
                name={data.isManualSelection ? 'common/manualSelect' : 'core/app/simpleMode/ai'}
                w={'20px'}
              />
              <Box
                ml={1}
                fontSize={'10px'}
                color={'myGray.600'}
                fontWeight={'500'}
                whiteSpace={'nowrap'}
              >
                {data.isManualSelection
                  ? t('dashboard_entries:manual_selection')
                  : t('dashboard_entries:intelligent_routing')}
              </Box>
            </Flex>
          </Box>
          <Box
            py={2}
            px={3}
            bg={'white'}
            borderRadius={'0 0 lg lg'}
            _hover={{
              bg: 'myGray.25'
            }}
            w={'100%'}
            maxW={'100%'}
          >
            <Flex align={'flex-start'}>
              <Box
                position={'relative'}
                w={'2.5rem'}
                h={'2.5rem'}
                borderRadius={'lg'}
                bg={'myGray.100'}
                display={'flex'}
                alignItems={'center'}
                justifyContent={'center'}
                flexShrink={0}
                border={'1px solid'}
                borderColor={'myGray.200'}
              >
                <Avatar src={data.appAvatar} w={'full'} h={'full'} borderRadius={'lg'} />
                {/* Watermark status icon */}
                <Box
                  position={'absolute'}
                  bottom={'-2px'}
                  right={'-2px'}
                  w={'14px'}
                  h={'14px'}
                  bg={'white'}
                  borderRadius={'full'}
                  display={'flex'}
                  alignItems={'center'}
                  justifyContent={'center'}
                  border={'1px solid'}
                  borderColor={'myGray.200'}
                  boxShadow={'0 1px 3px rgba(0,0,0,0.1)'}
                >
                  <MyIcon
                    name={isError ? 'common/closeLight' : 'common/check'}
                    w={'8px'}
                    h={'8px'}
                    color={isError ? 'red.500' : 'green.500'}
                  />
                </Box>
              </Box>
              <Box
                ml={3}
                flex={1}
                minH={'2.5rem'}
                display={'flex'}
                flexDirection={'column'}
                justifyContent={'center'}
              >
                <Box
                  fontSize={'sm'}
                  color={'myGray.800'}
                  fontWeight={'500'}
                  textAlign={'left'}
                  letterSpacing={'0.01em'}
                  lineHeight={'1.2'}
                >
                  {selectedApp}
                </Box>
                <Box fontSize={'xs'} color={'myGray.500'} mt={1} opacity={0.8} lineHeight={'1.3'}>
                  {reasonText}
                </Box>
              </Box>
            </Flex>
          </Box>
        </Box>
      </Box>
    );
  } catch (e) {
    console.error('Failed to parse AI routing data:', e);
    console.error('Raw text data:', text);
    console.error('Text length:', text.length);
    console.error('Text preview:', text.substring(0, 200));
    return null;
  }
};

export default AIRoutingCard;
