//
//  PartManagementView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/14.
//

import SwiftUI
import CoreData
import UIKit

struct PartManagementView: View {
    @Environment(\.managedObjectContext) private var viewContext
    @Binding var currentState: ViewState
    var box: NSManagedObject
    @Binding var selectedPart: NSManagedObject?
    @State private var showNameEditSheet = false
    @State private var editName = ""
    @State private var editingPart: NSManagedObject?
    @State private var editingPartName: String = ""
    @State private var refreshTrigger = UUID()
    @State private var showZeroQuantityAlert = false
    @State private var currentZeroQuantityPart: NSManagedObject? = nil
    // 数量编辑相关状态
    @State private var showQuantityEdit = false
    @State private var editQuantity: Int32 = 0
    @State private var currentEditingPart: NSManagedObject? = nil
    // 零件转盒相关状态
    @State private var showTransferSheet = false
    @State private var selectedPartsForTransfer: [NSManagedObject] = []
    @State private var selectedTargetRepository: NSManagedObject?
    @State private var selectedTargetBox: NSManagedObject?
    @State private var filteredBoxesInTargetRepository: [NSManagedObject] = []

    // 过滤当前盒子的零件
    private var filteredParts: [NSManagedObject] {
        // 使用refreshTrigger来触发重新计算
        _ = refreshTrigger
        
        var result: [NSManagedObject] = []
        // 使用viewContext获取所有零件
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
        fetchRequest.sortDescriptors = [NSSortDescriptor(key: "name", ascending: true)]
        do {
            let allParts = try viewContext.fetch(fetchRequest)
            for part in allParts {
                if let partBox = part.value(forKey: "box") as? NSManagedObject {
                    if partBox.objectID == box.objectID {
                        result.append(part)
                    }
                }
            }
        } catch {
            print("Error fetching parts: \(error)")
        }
        return result
    }

    var body: some View {
        VStack {
            // 标题
            Text("\(box.value(forKey: "name") as? String ?? "未命名盒子")盒子_零件管理")
                .font(.system(size: 32, weight: .bold))
                .padding(.top, 20)
                .padding(.bottom, 10)
                .multilineTextAlignment(.center)
            
            // 按钮栏和数量统计
            HStack {
                Button(action: {
                    addPart()
                }) {
                    Text("添加零件")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.blue)
                        .cornerRadius(10)
                        .shadow(radius: 2)
                }
                
                Button(action: {
                    showTransferSheet = true
                }) {
                    Text("零件转盒")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.green)
                        .cornerRadius(10)
                        .shadow(radius: 2)
                }
                
                Spacer()
                
                // 零件数量统计
                Text("共 \(filteredParts.count) 种零件")
                    .font(.system(size: 16))
                    .foregroundColor(.gray)
                
                Spacer()
                
                Button(action: {
                    currentState = .repositoryManagement
                }) {
                    Text("返回")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.red)
                        .cornerRadius(10)
                        .shadow(radius: 2)
                }
            }
            .padding(.horizontal, 30)
            .padding(.bottom, 20)
            
            // 零件列表
            GeometryReader { geometry in
                ScrollView {
                    // 根据屏幕宽度计算列数
                    let screenWidth = geometry.size.width
                    let minColumnWidth: CGFloat = 120
                    let columnSpacing: CGFloat = 10
                    let maxColumns = min(8, Int((screenWidth - 40) / (minColumnWidth + columnSpacing))) // 40是左右边距
                    let actualColumns = max(1, maxColumns)
                    
                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: columnSpacing), count: actualColumns), 
                        spacing: 15
                    ) {
                        ForEach(filteredParts, id: \.objectID) { part in
                            ZStack {
                                // 卡片背景
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color.white)
                                    .shadow(radius: 3, x: 0, y: 2)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8)
                                            .stroke(Color.blue.opacity(0.3), lineWidth: 1)
                                    )
                                
                                // 卡片内容
                                VStack(spacing: 6) {
                                    // 顶部型号
                                    Text(part.value(forKey: "part_num") as? String ?? "未定义型号")
                                        .font(.system(size: 10))
                                        .foregroundColor(.gray)
                                        .multilineTextAlignment(.center)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .padding(.top, 4)
                                    
                                    // 零件图片
                                    AsyncImageLoader(part: part)
                                        .frame(height: 60)
                                        .cornerRadius(4)
                                        .padding(.horizontal, 4)
                                    
                                    // 零件名称
                                    Text(part.value(forKey: "name") as? String ?? "未命名零件")
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundColor(.black)
                                        .multilineTextAlignment(.leading)
                                        .lineLimit(2)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .padding(.horizontal, 4)
                                    
                                    // 颜色名称
                                    let colorId = part.value(forKey: "color_id") as? Int32 ?? 0
                                    let colorName = getColorName(from: colorId)
                                    let colorDisplayText = colorName ?? "未知颜色"
                                    Text(colorDisplayText)
                                        .font(.system(size: 10))
                                        .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                                        .multilineTextAlignment(.leading)
                                        .lineLimit(2)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .padding(.horizontal, 4)
                                    
                                    // 底部信息
                                    HStack {
                                        // 新旧状态
                                        let isNew = part.value(forKey: "is_new") as? Bool ?? false
                                        Button(action: {
                                            togglePartNewStatus(part)
                                        }) {
                                            Text(isNew ? "新" : "旧")
                                                .font(.system(size: 9, weight: .bold))
                                                .foregroundColor(isNew ? .green : .orange)
                                                .padding(2)
                                                .background(isNew ? Color.green.opacity(0.1) : Color.orange.opacity(0.1))
                                                .cornerRadius(2)
                                        }
                                        .buttonStyle(PlainButtonStyle())
                                        
                                        Spacer()
                                        
                                        // 数量
                                        let quantity = part.value(forKey: "quantity") as? Int32 ?? 0
                                        Text("\(quantity)")
                                            .font(.system(size: 10, weight: .bold))
                                            .foregroundColor(.red)
                                    }
                                    .padding(.horizontal, 6)
                                    .padding(.bottom, 4)
                                }
                                
                                // 事件处理层 - 放在所有内容之上
                               if editingPart?.objectID != part.objectID {
                                   Color.clear
                                       .contentShape(Rectangle())
                                       .onTapGesture {
                                           print("点击零件卡片，进入零件详情页面")
                                           selectedPart = part
                                           currentState = .partDetail(part)
                                       }
                                       .simultaneousGesture(
                                           LongPressGesture(minimumDuration: 0.8)
                                               .onEnded { _ in
                                                   print("长按零件卡片，显示数量编辑弹窗")
                                                   editQuantity = part.value(forKey: "quantity") as? Int32 ?? 0
                                                   currentEditingPart = part
                                                   showQuantityEdit = true
                                                   print("设置showQuantityEdit为true，当前值: \(showQuantityEdit)")
                                               }
                                       )
                               }
                            }
                            .frame(minHeight: 180, maxHeight: 200) // 设置最小和最大高度
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                    .padding(.top, 10)
                }
            }
            .frame(maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0xF5/255, green: 0xF5/255, blue: 0xF5/255))
        .onAppear {
            // 页面加载时执行零件归并操作
            mergeDuplicateParts()
        }
        .alert(isPresented: $showZeroQuantityAlert) {
            Alert(
                title: Text("零件数量为0"),
                message: Text("该零件的数量为0，是否删除？\n\n零件型号: \(currentZeroQuantityPart?.value(forKey: "part_num") as? String ?? "")\n零件名称: \(currentZeroQuantityPart?.value(forKey: "name") as? String ?? "")"),
                primaryButton: .destructive(Text("删除"), action: handleDeleteZeroQuantityPart),
                secondaryButton: .cancel(Text("编辑"), action: handleCancelDeleteZeroQuantityPart)
            )
        }
        .sheet(isPresented: $showNameEditSheet) {
            VStack(spacing: 20) {
                Text("修改盒子名称")
                    .font(.system(size: 20, weight: .bold))
                    .padding(.top, 10)
                HStack(spacing: 15) {
                    TextField("盒子名称", text: $editName)
                        .font(.system(size: 16))
                        .padding(12)
                        .border(Color.gray.opacity(0.3))
                        .cornerRadius(8)
                        .frame(minWidth: 0, maxWidth: .infinity)
                        .textFieldStyle(.roundedBorder)
                    HStack(spacing: 12) {
                        Button(action: {
                            showNameEditSheet = false
                        }) {
                            Text("取消")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(Color.gray)
                                .cornerRadius(8)
                        }
                        Button(action: {
                            box.setValue(editName, forKey: "name")
                            do {
                                try viewContext.save()
                                // 触发视图刷新
                                refreshTrigger = UUID()
                            } catch {
                                let nsError = error as NSError
                                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
                            }
                            showNameEditSheet = false
                        }) {
                            Text("确定")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(Color.blue)
                                .cornerRadius(8)
                        }
                    }
                }
            }
            .padding(30)
            .frame(maxWidth: 300)
        }
        .overlay {
            GeometryReader { geometry in
                if showQuantityEdit {
                    ZStack {
                        // 半透明背景
                        Color.black.opacity(0.4)
                            .edgesIgnoringSafeArea(.all)
                            .onTapGesture {
                                showQuantityEdit = false
                            }
                        
                        // 弹窗内容
                        VStack(spacing: 12) {
                            Text("修改零件数量")
                                .font(.system(size: 16, weight: .bold))
                            
                            if let part = currentEditingPart {
                                Text("型号: \(part.value(forKey: "part_num") as? String ?? "未定义型号")")
                                    .font(.system(size: 12))
                                    .foregroundColor(.gray)
                                    .lineLimit(1)
                                
                                Text("名称: \(part.value(forKey: "name") as? String ?? "未命名零件")")
                                    .font(.system(size: 12))
                                    .foregroundColor(.gray)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.center)
                                
                                // 显示颜色名称
                                if let colorId = part.value(forKey: "color_id") as? Int32 {
                                    let colorName = getColorName(from: colorId) ?? "未知颜色"
                                    Text("颜色: \(colorName)")
                                        .font(.system(size: 12))
                                        .foregroundColor(.gray)
                                        .lineLimit(1)
                                }
                            } else {
                                Text("加载中...")
                                    .font(.system(size: 12))
                                    .foregroundColor(.gray)
                            }
                            
                            HStack(spacing: 15) {
                                Button(action: {
                                    if editQuantity > 0 {
                                        editQuantity -= 1
                                    }
                                }) {
                                    Text("−")
                                        .font(.system(size: 20, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 32, height: 32)
                                        .background(Color.gray)
                                        .cornerRadius(16)
                                }
                                
                                TextField("数量", value: $editQuantity, formatter: NumberFormatter())
                                    .font(.system(size: 18, weight: .bold))
                                    .multilineTextAlignment(.center)
                                    .frame(width: 80)
                                    .keyboardType(.numberPad)
                                
                                Button(action: {
                                    editQuantity += 1
                                }) {
                                    Text("+")
                                        .font(.system(size: 20, weight: .bold))
                                        .foregroundColor(.white)
                                        .frame(width: 32, height: 32)
                                        .background(Color.blue)
                                        .cornerRadius(16)
                                }
                            }
                            
                            HStack(spacing: 15) {
                                Button(action: {
                                    showQuantityEdit = false
                                }) {
                                    Text("取消")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 20)
                                        .padding(.vertical, 8)
                                        .background(Color.gray)
                                        .cornerRadius(6)
                                }
                                
                                Button(action: {
                                    if let part = currentEditingPart {
                                        savePartQuantity(part, editQuantity)
                                    }
                                    showQuantityEdit = false
                                }) {
                                    Text("保存")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 20)
                                        .padding(.vertical, 8)
                                        .background(Color.green)
                                        .cornerRadius(6)
                                }
                            }
                        }
                        .padding(20)
                        .background(Color.white)
                        .cornerRadius(10)
                        .shadow(radius: 8)
                        .frame(width: 350, height: 300)
                        .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
                    }
                }
            }
        }
        .ignoresSafeArea(.keyboard) // 忽略键盘影响
        .sheet(isPresented: $showTransferSheet) {
            GeometryReader { geometry in
                VStack(spacing: 15) {
                    // 计算总高度（包含所有内容）
                    let totalHeight = geometry.size.height - 40 // 减去整体padding
                    let upperSectionHeight = totalHeight * 4/5 // 上部区域占4/5
                    let lowerSectionHeight = totalHeight * 1/5 // 下部区域占1/5
                    
                    // 上部区域：包含大标题、小标题和零件选择区
                    VStack(spacing: 15) {
                        // 大标题
                        Text("零件转盒")
                            .font(.system(size: 20, weight: .bold))
                            .padding(.top, 10)
                        
                        // 零件选择区（包含小标题和按钮）
                        VStack(alignment: .leading, spacing: 10) {
                            // 小标题和按钮
                            HStack {
                                Text("选择需要移动的零件")
                                    .font(.system(size: 16, weight: .bold))
                                Spacer()
                                // 按钮放在标题右边
                                HStack(spacing: 10) {
                                    Button(action: {
                                        showTransferSheet = false
                                        selectedPartsForTransfer = []
                                        selectedTargetRepository = nil
                                        selectedTargetBox = nil
                                        filteredBoxesInTargetRepository = []
                                    }) {
                                        Text("取消")
                                            .font(.system(size: 12, weight: .bold))
                                            .foregroundColor(.white)
                                            .padding(.horizontal, 15)
                                            .padding(.vertical, 6)
                                            .background(Color.gray)
                                            .cornerRadius(6)
                                    }
                                    Button(action: {
                                        transferParts()
                                    }) {
                                        Text("确定")
                                            .font(.system(size: 12, weight: .bold))
                                            .foregroundColor(.white)
                                            .padding(.horizontal, 15)
                                            .padding(.vertical, 6)
                                            .background(Color.blue)
                                            .cornerRadius(6)
                                    }
                                }
                            }
                            
                            // 零件卡片网格
                            ScrollView {
                                LazyVGrid(
                                    columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), 
                                    spacing: 15
                                ) {
                                    ForEach(filteredParts, id: \.objectID) { part in
                                        ZStack {
                                            // 卡片背景
                                            RoundedRectangle(cornerRadius: 8)
                                                .fill(selectedPartsForTransfer.contains { $0.objectID == part.objectID } ? Color.blue.opacity(0.2) : Color.white)
                                                .stroke(selectedPartsForTransfer.contains { $0.objectID == part.objectID } ? Color.blue : Color.gray.opacity(0.3), lineWidth: 2)
                                                .shadow(radius: 2)
                                            
                                            // 卡片内容
                                            VStack(spacing: 6) {
                                                // 零件图片
                                                // 零件图片
                                                AsyncImageLoader(part: part)
                                                    .frame(height: 60)
                                                    .cornerRadius(4)
                                                    .padding(.horizontal, 4)
                                                
                                                // 底部信息：型号和数量（左右）
                                                HStack {
                                                    // 型号
                                                    Text(part.value(forKey: "part_num") as? String ?? "未定义型号")
                                                        .font(.system(size: 9, weight: .bold))
                                                        .foregroundColor(.gray)
                                                        .lineLimit(1)
                                                        .fixedSize(horizontal: false, vertical: true)
                                                    
                                                    Spacer()
                                                    
                                                    // 数量
                                                    let quantity = part.value(forKey: "quantity") as? Int32 ?? 0
                                                    Text("\(quantity)")
                                                        .font(.system(size: 9, weight: .bold))
                                                        .foregroundColor(.red)
                                                }
                                                .padding(.horizontal, 6)
                                                .padding(.bottom, 4)
                                            }
                                            .padding(6)
                                        }
                                        .frame(height: 100)
                                        .onTapGesture {
                                            if selectedPartsForTransfer.contains(where: { $0.objectID == part.objectID }) {
                                                selectedPartsForTransfer.removeAll(where: { $0.objectID == part.objectID })
                                            } else {
                                                selectedPartsForTransfer.append(part)
                                            }
                                        }
                                    }
                                }
                                .padding(.vertical, 10)
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                    .frame(height: upperSectionHeight)
                    
                    // 下部区域：包含标题和位置选择区
                    VStack(spacing: 10) {
                        // 位置选择区（包含标题）
                        VStack(alignment: .leading, spacing: 10) {
                            // 标题
                            Text("选择目标位置")
                                .font(.system(size: 16, weight: .bold))
                            
                            // 左右两栏布局：左边仓库（1/9），右边盒子（8/9）
                            HStack(spacing: 10) {
                                // 左边仓库列表
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("仓库")
                                        .font(.system(size: 12, weight: .bold))
                                    ScrollView {
                                        VStack(spacing: 6) {
                                            ForEach(getAllRepositories(), id: \.objectID) { repo in
                                                ZStack {
                                                    // 卡片背景
                                                    RoundedRectangle(cornerRadius: 4)
                                                        .fill(selectedTargetRepository?.objectID == repo.objectID ? Color.green.opacity(0.2) : Color.white)
                                                        .stroke(selectedTargetRepository?.objectID == repo.objectID ? Color.green : Color.gray.opacity(0.3), lineWidth: 1.5)
                                                        .shadow(radius: 1)
                                                    
                                                    // 卡片内容
                                                    VStack(spacing: 2) {
                                                        Text(repo.value(forKey: "name") as? String ?? "未命名仓库")
                                                            .font(.system(size: 9, weight: .bold))
                                                            .multilineTextAlignment(.center)
                                                            .lineLimit(2)
                                                    }
                                                    .padding(4)
                                                }
                                                .frame(height: 28) // 设置仓库卡片高度为28
                                                .onTapGesture {
                                                    selectedTargetRepository = repo
                                                    // 清空目标盒子选择
                                                    selectedTargetBox = nil
                                                    // 过滤目标仓库的盒子
                                                    filterBoxesInRepository(repo)
                                                }
                                            }
                                        }
                                        .padding(.vertical, 3)
                                    }
                                    .frame(height: 120) // 设置固定高度
                                }
                                .frame(width: 80) // 固定宽度，实现1:8比例
                                
                                // 右边盒子列表
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("盒子")
                                        .font(.system(size: 12, weight: .bold))
                                    ScrollView {
                                        if !filteredBoxesInTargetRepository.isEmpty {
                                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 5), spacing: 10) {
                                                ForEach(filteredBoxesInTargetRepository, id: \.objectID) { targetBox in
                                                    ZStack {
                                                        // 卡片背景
                                                        RoundedRectangle(cornerRadius: 4)
                                                            .fill(selectedTargetBox?.objectID == targetBox.objectID ? Color.green.opacity(0.2) : Color.white)
                                                            .stroke(selectedTargetBox?.objectID == targetBox.objectID ? Color.green : Color.gray.opacity(0.3), lineWidth: 1.5)
                                                            .shadow(radius: 1)
                                                        
                                                        // 卡片内容
                                                        VStack(spacing: 2) {
                                                            Text(targetBox.value(forKey: "name") as? String ?? "未命名盒子")
                                                                .font(.system(size: 9, weight: .bold))
                                                                .multilineTextAlignment(.center)
                                                                .lineLimit(2)
                                                        }
                                                        .padding(4)
                                                    }
                                                    .frame(height: 28) // 调整盒子卡片高度为28
                                                    .onTapGesture {
                                                        selectedTargetBox = targetBox
                                                    }
                                                }
                                            }
                                            .padding(.vertical, 3)
                                        } else {
                                            Text("请先选择仓库")
                                                .font(.system(size: 12))
                                                .foregroundColor(.gray)
                                                .padding(.vertical, 30)
                                        }
                                    }
                                    .frame(height: 120) // 设置固定高度
                                }
                                .frame(maxWidth: .infinity) // 占剩余宽度
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                    .frame(height: lowerSectionHeight)
                }
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
    
    // 保存零件数量
    private func savePartQuantity(_ part: NSManagedObject, _ quantity: Int32) {
        print("保存零件数量: \(quantity)")
        part.setValue(quantity, forKey: "quantity")
        do {
            try viewContext.save()
            print("保存成功")
            // 确保退出编辑模式
            editingPart = nil
            editingPartName = ""
            // 立即刷新
            refreshTrigger = UUID()
            print("刷新视图")
        } catch {
            let nsError = error as NSError
            print("保存错误: \(nsError)")
            fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
        }
    }

    private func addPart() {
        // 切换到添加零件页面
        currentState = .addPart(box)
    }



    private func togglePartNewStatus(_ part: NSManagedObject) {
        let currentStatus = part.value(forKey: "is_new") as? Bool ?? false
        let newStatus = !currentStatus
        part.setValue(newStatus, forKey: "is_new")
        do {
            try viewContext.save()
            print("零件新旧状态更新成功: \(newStatus ? "新" : "旧")")
            // 刷新视图
            refreshTrigger = UUID()
        } catch {
            let nsError = error as NSError
            print("保存零件新旧状态失败: \(nsError)")
        }
    }
    
    // 检查并处理数量为0的零件
    private func checkAndHandleZeroQuantityParts() {
        print("开始检查数量为0的零件...")
        
        // 获取所有零件
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
        var allParts: [NSManagedObject] = []
        
        do {
            allParts = try viewContext.fetch(fetchRequest)
            print("获取到 \(allParts.count) 个零件")
        } catch {
            print("获取零件失败: \(error)")
            return
        }
        
        // 找出数量为0的零件
        var zeroQuantityParts: [NSManagedObject] = []
        
        for part in allParts {
            let quantity = part.value(forKey: "quantity") as? Int32 ?? 0
            if quantity <= 0 {
                zeroQuantityParts.append(part)
            }
        }
        
        print("找到 \(zeroQuantityParts.count) 个数量为0的零件")
        
        // 如果有数量为0的零件，显示确认对话框
        if let firstZeroPart = zeroQuantityParts.first {
            currentZeroQuantityPart = firstZeroPart
            showZeroQuantityAlert = true
        }
    }
    
    // 处理确认删除数量为0的零件
    private func handleDeleteZeroQuantityPart() {
        if let part = currentZeroQuantityPart {
            viewContext.delete(part)
            print("已删除数量为0的零件: \(part.value(forKey: "part_num") as? String ?? "")")
            
            // 保存上下文
            do {
                try viewContext.save()
                print("保存删除结果成功")
                // 刷新视图
                refreshTrigger = UUID()
                // 继续检查其他数量为0的零件
                checkAndHandleZeroQuantityParts()
            } catch {
                print("保存删除结果失败: \(error)")
            }
        }
        
        // 重置状态
        showZeroQuantityAlert = false
        currentZeroQuantityPart = nil
    }
    
    // 处理取消删除，转到零件编辑页面
    private func handleCancelDeleteZeroQuantityPart() {
        if let part = currentZeroQuantityPart {
            print("用户选择编辑数量为0的零件: \(part.value(forKey: "part_num") as? String ?? "")")
            // 转到零件编辑页面
            selectedPart = part
            currentState = .partDetail(part)
        }
        
        // 重置状态
        showZeroQuantityAlert = false
        currentZeroQuantityPart = nil
    }
    
    // 归并相同型号、颜色和新旧状态的零件，数量叠加
    private func mergeDuplicateParts() {
        print("开始归并重复零件...")
        
        // 获取所有零件
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
        var allParts: [NSManagedObject] = []
        
        do {
            allParts = try viewContext.fetch(fetchRequest)
            print("获取到 \(allParts.count) 个零件")
        } catch {
            print("获取零件失败: \(error)")
            return
        }
        
        // 按型号、颜色、新旧状态分组
        var partGroups: [String: [NSManagedObject]] = [:]
        
        for part in allParts {
            let partNum = part.value(forKey: "part_num") as? String ?? ""
            let colorId = part.value(forKey: "color_id") as? Int32 ?? 0
            let isNew = part.value(forKey: "is_new") as? Bool ?? false
            let boxId = part.entity.attributesByName.keys.contains("boxId") ? (part.value(forKey: "boxId") as? Int32 ?? -1) : -1
            
            // 生成唯一的分组键，包含型号、颜色、状态和盒子ID
            let groupKey = "\(partNum)-\(colorId)-\(isNew)-\(boxId)"
            
            if var group = partGroups[groupKey] {
                group.append(part)
                partGroups[groupKey] = group
            } else {
                partGroups[groupKey] = [part]
            }
        }
        
        print("共分为 \(partGroups.count) 组零件")
        
        // 对每组零件进行归并
        var mergedCount = 0
        var deletedCount = 0
        
        for (key, parts) in partGroups {
            if parts.count > 1 {
                // 保留第一个零件
                let mainPart = parts[0]
                var totalQuantity: Int32 = mainPart.value(forKey: "quantity") as? Int32 ?? 0
                
                // 累加其他零件的数量
                for i in 1..<parts.count {
                    let part = parts[i]
                    let partQuantity = part.value(forKey: "quantity") as? Int32 ?? 0
                    totalQuantity += partQuantity
                    
                    // 删除多余的零件
                    viewContext.delete(part)
                    deletedCount += 1
                }
                
                // 更新主零件的数量
                mainPart.setValue(totalQuantity, forKey: "quantity")
                mergedCount += 1
                print("归并组 \(key): 从 \(parts.count) 个零件合并为 1 个，总数量: \(totalQuantity)")
            }
        }
        
        // 保存上下文
        do {
            try viewContext.save()
            print("归并操作完成: 归并了 \(mergedCount) 组，删除了 \(deletedCount) 个零件")
        } catch {
            print("保存归并结果失败: \(error)")
        }
        
        // 处理数量为0的零件
        checkAndHandleZeroQuantityParts()
    }

    private func saveContext() {
        do {
            try viewContext.save()
        } catch {
            let nsError = error as NSError
            fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
        }
    }
    
    // 获取所有仓库
    private func getAllRepositories() -> [NSManagedObject] {
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Repository")
        fetchRequest.sortDescriptors = [NSSortDescriptor(key: "name", ascending: true)]
        do {
            return try viewContext.fetch(fetchRequest)
        } catch {
            print("Error fetching repositories: \(error)")
            return []
        }
    }
    
    // 过滤指定仓库的盒子
    private func filterBoxesInRepository(_ repository: NSManagedObject) {
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
        fetchRequest.sortDescriptors = [NSSortDescriptor(key: "boxNumber", ascending: true)]
        do {
            let allBoxes = try viewContext.fetch(fetchRequest)
            filteredBoxesInTargetRepository = allBoxes.filter { 
                if let repoId = $0.value(forKey: "repositoryId") as? Int32,
                   let targetRepoId = repository.value(forKey: "id") as? Int32 {
                    return repoId == targetRepoId
                }
                return false
            }
        } catch {
            print("Error fetching boxes: \(error)")
            filteredBoxesInTargetRepository = []
        }
    }
    
    // 执行零件转盒
    private func transferParts() {
        guard !selectedPartsForTransfer.isEmpty, let targetBox = selectedTargetBox else {
            return
        }
        
        // 批量处理选中的零件
        for part in selectedPartsForTransfer {
            // 更新零件的box关联
            part.setValue(targetBox, forKey: "box")
            // 更新零件的boxId
            if let boxId = targetBox.value(forKey: "id") as? Int32 {
                if part.entity.attributesByName.keys.contains("boxId") {
                    part.setValue(boxId, forKey: "boxId")
                }
            }
        }
        
        do {
            try viewContext.save()
            // 触发视图刷新
            refreshTrigger = UUID()
            
            // 关闭sheet并重置状态
            showTransferSheet = false
            selectedPartsForTransfer = []
            selectedTargetRepository = nil
            selectedTargetBox = nil
            filteredBoxesInTargetRepository = []
        } catch {
            let nsError = error as NSError
            fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
        }
    }
    
    // 检查并加载缺失的零件图片URL
    private func loadMissingPartImages() {
        print("开始检查并加载缺失的零件图片")
        
        // 获取当前盒子的所有零件
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
        do {
            let allParts = try viewContext.fetch(fetchRequest)
            var partsInCurrentBox: [NSManagedObject] = []
            
            // 过滤出当前盒子的零件
            for part in allParts {
                if let partBox = part.value(forKey: "box") as? NSManagedObject {
                    if partBox.objectID == box.objectID {
                        partsInCurrentBox.append(part)
                    }
                }
            }
            
            print("当前盒子中有 \(partsInCurrentBox.count) 个零件")
            
            let persistence = PersistenceController.shared
            
            for part in partsInCurrentBox {
                // 尝试从RB数据库的inventory_parts表中获取图片URL
                if let partNum = part.value(forKey: "part_num") as? String, 
                   let colorId = part.value(forKey: "color_id") as? Int32 {
                    
                    print("尝试从RB数据库获取图片URL: \(partNum), 颜色: \(colorId)")
                    
                    let inventoryFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Inventory_parts")
                    inventoryFetchRequest.predicate = NSPredicate(format: "part_num == %@ AND color_id == %d", partNum, colorId)
                    
                    do {
                        let viewContext = persistence.rbContainer.viewContext
                        let inventoryParts = try viewContext.fetch(inventoryFetchRequest)
                        print("找到 \(inventoryParts.count) 个匹配的inventory_parts记录")
                        
                    } catch {
                        print("获取inventory_parts失败: \(error)")
                    }
                } else {
                    print("零件型号或颜色ID为空，无法获取图片URL")
                    print("零件型号: \(part.value(forKey: "part_num") as? String ?? "nil")")
                    print("颜色ID: \(part.value(forKey: "color_id") as? Int32 ?? -1)")
                }
            }
        } catch {
            print("获取零件失败: \(error)")
        }
    }
}
