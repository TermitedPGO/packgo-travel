import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Send, Sparkles, User } from "lucide-react";
import { useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AIAdvisor() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "您好！我是您的專屬 AI 旅遊顧問。請告訴我您想去的目的地、季節或人數，讓我為您規劃完美的旅程！",
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = input;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsTyping(true);

    // Simulate AI response delay
    setTimeout(() => {
      let response = "";
      if (userMessage.includes("日本") || userMessage.includes("櫻花")) {
        response = "太棒了！春季的日本正是賞櫻的最佳時節。我推薦您參加我們的「關東賞櫻 5 日遊」，包含東京、箱根和富士山。您預計幾位出發呢？";
      } else if (userMessage.includes("歐洲")) {
        response = "歐洲充滿了歷史與浪漫！如果您是第一次去，我建議從「英國、法國雙國 10 日遊」開始。請問您偏好深度旅遊還是多國遊覽？";
      } else {
        response = "收到您的需求！我會根據您的喜好為您篩選最適合的行程。請問您有預算的考量嗎？";
      }

      setMessages((prev) => [...prev, { role: "assistant", content: response }]);
      setIsTyping(false);
    }, 1500);
  };

  return (
    <Card className="w-full max-w-md mx-auto bg-white/95 backdrop-blur shadow-2xl border-primary/20 overflow-hidden flex flex-col h-[500px]">
      {/* Header */}
      <div className="bg-primary p-4 flex items-center gap-3 text-white">
        <div className="bg-white/20 p-2 rounded-full">
          <Bot className="h-6 w-6" />
        </div>
        <div>
          <h3 className="font-bold text-lg flex items-center gap-2">
            AI 旅遊顧問
            <Sparkles className="h-4 w-4 text-yellow-300 animate-pulse" />
          </h3>
          <p className="text-xs text-primary-foreground/80">24小時為您服務</p>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4 bg-gray-50">
        <div className="space-y-4">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex gap-3 ${
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === "user"
                    ? "bg-gray-200 text-gray-600"
                    : "bg-primary/10 text-primary"
                }`}
              >
                {msg.role === "user" ? (
                  <User className="h-5 w-5" />
                ) : (
                  <Bot className="h-5 w-5" />
                )}
              </div>
              <div
                className={`max-w-[80%] p-3 rounded-lg text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-gray-800 text-white"
                    : "bg-white border border-gray-100 text-gray-800 shadow-sm"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Bot className="h-5 w-5" />
              </div>
              <div className="bg-white border border-gray-100 p-3 rounded-xl shadow-sm flex items-center gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-gray-100">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="輸入您的旅遊需求..."
            className="flex-1 border-gray-200 focus-visible:ring-primary"
          />
          <Button type="submit" size="icon" className="bg-primary hover:bg-primary/90 text-white shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </Card>
  );
}
