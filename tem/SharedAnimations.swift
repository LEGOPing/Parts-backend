import SwiftUI

// 沙漏动画视图
struct HourglassAnimation: View {
    @State private var rotation: Double = 0
    @State private var scale: CGFloat = 1
    
    var body: some View {
        ZStack {
            // 沙漏顶部
            Path {
                $0.move(to: CGPoint(x: 20, y: 5))
                $0.addLine(to: CGPoint(x: 40, y: 25))
                $0.addLine(to: CGPoint(x: 40, y: 45))
                $0.addLine(to: CGPoint(x: 20, y: 25))
                $0.closeSubpath()
            }
            .fill(Color.blue.opacity(0.8))
            
            // 沙漏中间
            Rectangle()
                .fill(Color.blue.opacity(0.8))
                .frame(width: 5, height: 10)
                .position(x: 30, y: 30)
            
            // 沙漏底部
            Path {
                $0.move(to: CGPoint(x: 20, y: 55))
                $0.addLine(to: CGPoint(x: 40, y: 35))
                $0.addLine(to: CGPoint(x: 40, y: 55))
                $0.addLine(to: CGPoint(x: 20, y: 35))
                $0.closeSubpath()
            }
            .fill(Color.blue.opacity(0.4))
            
            // 流动的沙子
            Path {
                $0.move(to: CGPoint(x: 25, y: 25))
                $0.addLine(to: CGPoint(x: 35, y: 25))
                $0.addLine(to: CGPoint(x: 35, y: 35))
                $0.addLine(to: CGPoint(x: 25, y: 35))
                $0.closeSubpath()
            }
            .fill(Color.blue.opacity(0.6))
        }
        .frame(width: 60, height: 60)
        .rotationEffect(.degrees(rotation))
        .scaleEffect(scale)
        .onAppear {
            withAnimation(Animation.linear(duration: 2).repeatForever(autoreverses: false)) {
                rotation = 360
            }
            
            withAnimation(Animation.easeInOut(duration: 1).repeatForever(autoreverses: true)) {
                scale = 0.9
            }
        }
    }
}
