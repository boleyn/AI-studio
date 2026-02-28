import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, FormControl, FormErrorMessage } from '@chakra-ui/react';
import { Controller, useForm, type UseFormHandleSubmit } from 'react-hook-form';
import Markdown from '@/components/Markdown';
import QuestionTip from '@/components/common/MyTooltip/QuestionTip';
import {
  type UserInputInteractive,
  type UserSelectInteractive,
  type UserSelectOptionItemType
} from '@/global/core/workflow/template/system/interactive/type';
import InputRender from '@/components/core/app/formRender';
import { nodeInputTypeToInputType } from '@/components/core/app/formRender/utils';
import FormLabel from '@/components/common/MyBox/FormLabel';
import LeftRadio from '@/components/common/Radio/LeftRadio';
import { getPresignedChatFileGetUrl } from '@/shared/api/chatFile';
import { useTranslation } from 'next-i18next';

const DescriptionBox = React.memo(function DescriptionBox({
  description
}: {
  description?: string;
}) {
  if (!description) return null;
  return (
    <Box mb={4}>
      <Markdown source={description} />
    </Box>
  );
});

export const SelectOptionsComponent = React.memo(function SelectOptionsComponent({
  interactiveParams,
  onSelect
}: {
  interactiveParams: UserSelectInteractive['params'];
  onSelect: (value: string) => void;
}) {
  const { description, userSelectOptions, userSelectedVal } = interactiveParams;
  const autoStopRef = useRef(false);
  const { cleanedDescription, autoStopSeconds } = useMemo(() => {
    if (!description) {
      return { cleanedDescription: description, autoStopSeconds: undefined };
    }
    const match = description.match(/<!--fastgpt:auto-continue:(\d+)-->/);
    const seconds = match ? Number(match[1]) : undefined;
    return {
      cleanedDescription: description.replace(/<!--fastgpt:auto-continue:\d+-->/, '').trim(),
      autoStopSeconds: Number.isFinite(seconds) ? seconds : undefined
    };
  }, [description]);
  const [remaining, setRemaining] = useState(autoStopSeconds || 0);
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const [localStopped, setLocalStopped] = useState(false);
  const isAutoContinue = !!autoStopSeconds;
  const effectiveSelected = userSelectedVal ?? localSelected ?? '';

  useEffect(() => {
    if (!autoStopSeconds || userSelectedVal || localStopped) return;
    autoStopRef.current = false;
    setRemaining(autoStopSeconds);
    const startAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startAt) / 1000);
      const next = Math.max(autoStopSeconds - elapsed, 0);
      setRemaining(next);
      if (next <= 0) {
        clearInterval(timer);
        if (!autoStopRef.current) {
          autoStopRef.current = true;
          setLocalSelected('停止');
          setLocalStopped(true);
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [autoStopSeconds, localStopped, userSelectedVal]);

  return (
    <Box maxW={'100%'}>
      <DescriptionBox description={cleanedDescription} />
      {!!autoStopSeconds && !userSelectedVal && (
        <Box mb={3} fontSize={'xs'} color={'myGray.500'}>
          将在 {remaining}s 后自动停止
        </Box>
      )}
      {localStopped && (
        <Box mb={3} fontSize={'xs'} color={'myGray.500'}>
          已停止
        </Box>
      )}
      <Box w={'250px'}>
        <LeftRadio<string>
          py={3.5}
          gridGap={3}
          align={'center'}
          list={userSelectOptions.map((option: UserSelectOptionItemType) => ({
            title: (
              <Box fontSize={'sm'} whiteSpace={'pre-wrap'} wordBreak={'break-word'}>
                {option.value}
              </Box>
            ),
            value: option.value
          }))}
          value={effectiveSelected}
          defaultBg={'white'}
          activeBg={'white'}
          onChange={(val) => {
            if (isAutoContinue && (val === '停止' || val.toLowerCase() === 'stop')) {
              setLocalSelected(val);
              setLocalStopped(true);
              return;
            }
            onSelect(val);
          }}
          isDisabled={!!userSelectedVal || localStopped}
        />
      </Box>
    </Box>
  );
});

export const FormInputComponent = React.memo(function FormInputComponent({
  interactiveParams: { description, inputForm, submitted },
  defaultValues = {},
  SubmitButton
}: {
  interactiveParams: UserInputInteractive['params'];
  defaultValues?: Record<string, any>;
  SubmitButton: (e: {
    onSubmit: UseFormHandleSubmit<Record<string, any>>;
    isFileUploading: boolean;
  }) => React.JSX.Element;
}) {
  const { t } = useTranslation();

  const { handleSubmit, control, watch, setValue } = useForm({
    defaultValues
  });

  const formValues = watch();

  // 刷新文件 URL（处理 TTL 过期）
  useEffect(() => {
    if (!submitted || !inputForm) return;

    const refreshFileUrls = async () => {
      for (const item of inputForm) {
        if (item.type === 'fileSelect' && defaultValues[item.key]) {
          const files = defaultValues[item.key];
          if (Array.isArray(files) && files.length > 0 && files[0]?.key) {
            try {
              const refreshedFiles = await Promise.all(
                files.map(async (file: any) => {
                  if (file.key) {
                    try {
                      const newUrl = await getPresignedChatFileGetUrl({
                        key: file.key
                      });
                      return {
                        ...file,
                        url: newUrl,
                        icon: file.type === 'image' ? newUrl : file.icon
                      };
                    } catch (e) {}
                  }
                  return file;
                })
              );
              setValue(item.key, refreshedFiles);
            } catch (e) {}
          }
        }
      }
    };

    refreshFileUrls();
  }, [submitted, inputForm, defaultValues, setValue]);

  const isFileUploading = React.useMemo(() => {
    return inputForm.some((input) => {
      if (input.type === 'fileSelect') {
        const files = formValues[input.key];
        if (Array.isArray(files)) {
          return files.some((file: any) => !file.url && !file.error);
        }
      }
      return false;
    });
  }, [inputForm, formValues]);

  return (
    <Box>
      <DescriptionBox description={description} />
      <Flex flexDirection={'column'} gap={3}>
        {inputForm.map((input) => {
          const inputType = nodeInputTypeToInputType([input.type]);

          return (
            <Controller
              key={input.key}
              control={control}
              name={input.key}
              rules={{
                required: input.required,
                validate: (value) => {
                  if (input.type === 'password' && input.minLength) {
                    if (!value || typeof value !== 'object' || !value.value) {
                      return false;
                    }
                    if (value.value.length < input.minLength) {
                      return t('common:min_length', { minLenth: input.minLength });
                    }
                  }
                  if (input.type === 'fileSelect' && input.required) {
                    if (!value || !Array.isArray(value) || value.length === 0) {
                      return t('common:required');
                    }
                  }
                  return true;
                }
              }}
              render={({ field: { onChange, value }, fieldState: { error } }) => {
                return (
                  <FormControl isInvalid={!!error}>
                    <Flex alignItems={'center'} mb={1}>
                      {input.required && <Box color={'red.500'}>*</Box>}
                      <FormLabel>{input.label}</FormLabel>
                      {input.description && <QuestionTip ml={1} label={input.description} />}
                    </Flex>
                    <InputRender
                      {...input}
                      inputType={inputType}
                      value={value}
                      onChange={onChange}
                      isDisabled={submitted}
                      isInvalid={!!error}
                      isRichText={false}
                    />
                    {error && <FormErrorMessage>{error.message}</FormErrorMessage>}
                  </FormControl>
                );
              }}
            />
          );
        })}
      </Flex>

      {!submitted && (
        <Flex justifyContent={'flex-end'} mt={4}>
          <SubmitButton onSubmit={handleSubmit} isFileUploading={isFileUploading} />
        </Flex>
      )}
    </Box>
  );
});
