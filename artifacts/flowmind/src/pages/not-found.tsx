import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-full flex items-center justify-center p-6 relative overflow-hidden">

      {/* Ambient background orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-primary/5 rounded-full blur-2xl" />
      </div>

      <div className="relative z-10 text-center max-w-lg mx-auto space-y-8">
        {/* Animated 404 numeral */}
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 180, damping: 18 }}
          className="relative inline-flex items-center justify-center"
        >
          <span
            className="text-[160px] md:text-[220px] font-black leading-none select-none tracking-tighter"
            style={{
              background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.3) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            404
          </span>
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="w-[140px] md:w-[190px] h-[140px] md:h-[190px] rounded-full border border-primary/10 border-dashed" />
          </motion.div>
        </motion.div>

        {/* Icon + message */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 250, damping: 24 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-center gap-3 mb-2">
            <div className="p-2.5 bg-primary/12 rounded-xl text-primary">
              <Mic className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Signal Lost</h1>
          </div>
          <p className="text-muted-foreground text-base leading-relaxed max-w-sm mx-auto">
            This frequency doesn't exist in our network. The page you're looking for has gone dark.
          </p>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, type: "spring", stiffness: 250, damping: 24 }}
        >
          <Link href="/" data-testid="link-back-to-dashboard">
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button size="lg" className="h-12 px-7 gap-2.5 rounded-xl font-semibold shadow-lg shadow-primary/20">
                <ArrowLeft className="h-4 w-4" />
                Back to Mission Control
              </Button>
            </motion.div>
          </Link>
        </motion.div>

        {/* Decorative dots */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex items-center justify-center gap-2 pt-2"
        >
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{ scale: [1, 1.4, 1], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.25 }}
              className="w-1.5 h-1.5 rounded-full bg-primary/40"
            />
          ))}
        </motion.div>
      </div>
    </div>
  );
}
