import type { ChatMessage } from '../services/openai'
import { DURATION_TIERS } from './config'

export function buildReviseMessages(
  city: string,
  params: any,
  targetContext: string,
  feedback: string,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `如果提问内容与当前对话主题无关，如非旅行行程规划相关，请选择不回答，并礼貌告知用户`,
    },
    {
      role: 'user',
      content: `你是一个旅行行程规划助手。用户正在查看以下行程安排：

城市：${city}
旅行偏好：${params.preferences?.join('、') || '综合'}
${targetContext}

用户的修改意见：
${feedback}

请理解用户的意图并回复。如果用户要求修改或替换某个活动，请在回复末尾用如下 JSON 格式给出替换方案（包在【】中）：
【{"day":1,"index":0,"activity":{"name":"新活动名","description":"描述","location":"位置","duration":60,"time":"09:00","address":"地址"}}】

其中 day 是第几天（从1开始），index 是该天活动的序号（从0开始），activity 是替换后的活动。

规则：
- duration 参考以下${DURATION_TIERS}
- time 需要与前后活动的时间衔接，景点间留 15-45 分钟交通时间
- 先用自然语言解释你的修改建议，最后再给出 JSON
- 如果用户想增加一个活动，index 填 -1 表示追加到当天末尾
- 如果用户想删除一个活动，activity 填 null

如果用户只是提问或讨论，不需要给出 JSON，直接回复即可。`,
    },
  ]
}
